/* -*- Mode: C++; tab-width: 2; indent-tabs-mode: nil; c-basic-offset: 2 -*- */
/* vim:set ts=2 sw=2 sts=2 et cindent: */
/* This Source Code Form is subject to the terms of the Mozilla Public
* License, v. 2.0. If a copy of the MPL was not distributed with this
* file, You can obtain one at http://mozilla.org/MPL/2.0/. */

#include <Windows.h>
#include <Bits.h>
#include <Winhttp.h> // BITS sometimes returns WinHTTP error codes
#include "ErrorList.h"

// From https://msdn.microsoft.com/en-us/library/windows/desktop/aa362800.aspx
#define BITS_REMOTE_NAME_MAX_LEN 2200
#define BITS_LOCAL_NAME_MAX_LEN MAX_PATH

#define BITS_JOB_DISPLAY_NAME L"Mozilla Update Agent"

#define BITS_JOB_STATUS_POLL_MS 60000

int
GetNSResult(HRESULT hr)
{
  switch (hr) {
    case S_OK:
      return (int)NS_OK;
    case E_INVALIDARG:
      return (int)NS_ERROR_INVALID_ARG;
    case E_ACCESSDENIED:
      return (int)NS_ERROR_FILE_ACCESS_DENIED;
    case (HRESULT)BG_E_NETWORK_DISCONNECTED:
      return (int)NS_ERROR_NET_RESET;
    case (HRESULT)BG_E_HTTP_ERROR_404:
      return (int)NS_ERROR_FILE_NOT_FOUND;
    case __HRESULT_FROM_WIN32(ERROR_WINHTTP_TIMEOUT):
      return (int)NS_ERROR_NET_TIMEOUT;
    case __HRESULT_FROM_WIN32(ERROR_WINHTTP_NAME_NOT_RESOLVED):
      return (int)NS_ERROR_UNKNOWN_HOST;
    case __HRESULT_FROM_WIN32(ERROR_WINHTTP_CANNOT_CONNECT):
    case __HRESULT_FROM_WIN32(ERROR_WINHTTP_CONNECTION_ERROR):
      return (int)NS_ERROR_CONNECTION_REFUSED;
    default:
      return (int)NS_ERROR_UNEXPECTED;
  }
}

template<typename T>
class ComObjectWrapper
{
public:
  ComObjectWrapper() : mObj(nullptr) { };
  explicit ComObjectWrapper(T* obj) : mObj(obj) { };

  ~ComObjectWrapper()
  {
    if (mObj) {
      mObj->Release();
      mObj = nullptr;
    }
  }

  operator T*()
  {
    return mObj;
  }
  T* operator->()
  {
    return mObj;
  }
  T** operator&()
  {
    return &mObj;
  }
private:
  T* mObj;
};

class BitsListener : public IBackgroundCopyCallback
{
public:
  BitsListener() :
    mRefCount(1),
    mDoneEvent(CreateEvent(nullptr, FALSE, FALSE, nullptr)),
    mResult(S_OK) { }
  ~BitsListener()
  {
    CloseHandle(mDoneEvent);
  }

  // IUnknown methods
  virtual HRESULT __stdcall
  QueryInterface(REFIID riid, LPVOID *ppvObj)
  {
    if (IsEqualIID(riid, __uuidof(IBackgroundCopyCallback))) {
      *ppvObj = static_cast<IBackgroundCopyCallback*>(this);
    } else if (IsEqualIID(riid, __uuidof(IUnknown))) {
      *ppvObj = reinterpret_cast<IUnknown*>(this);
    } else {
      *ppvObj = nullptr;
      return E_NOINTERFACE;
    }

    AddRef();
    return NOERROR;
  }

  virtual ULONG __stdcall
  AddRef()
  {
    return InterlockedIncrement(&mRefCount);
  }

  virtual ULONG __stdcall
  Release()
  {
    ULONG ulCount = InterlockedDecrement(&mRefCount);
    if (0 >= ulCount) {
      delete this;
    }

    return ulCount;
  }

  // IBackgroundCopyCallback methods
  virtual HRESULT __stdcall
  JobTransferred(IBackgroundCopyJob* pJob)
  {
    mResult = pJob->Complete();

    SetEvent(mDoneEvent);

    return S_OK;
  }

  virtual HRESULT __stdcall
  JobError(IBackgroundCopyJob* pJob, IBackgroundCopyError* pError)
  {
    BG_ERROR_CONTEXT context;
    pError->GetError(&context, &mResult);

    pJob->Cancel();

    SetEvent(mDoneEvent);

    return S_OK;
  }

  virtual HRESULT __stdcall
  JobModification(IBackgroundCopyJob* pJob, DWORD dwReserved)
  {
    // We don't request job modification notifications.
    return S_OK;
  }

  // Custom methods
  HRESULT
  WaitUntilFinished(IBackgroundCopyJob* pJob)
  {
    // "Transient" errors do not result in a call to JobError, so we have to
    // pretty much poll for them by constantly checking the job state.
    BG_JOB_STATE state;
    pJob->GetState(&state);
    while (state <= BG_JOB_STATE_TRANSFERRING) {
      WaitForSingleObject(mDoneEvent, BITS_JOB_STATUS_POLL_MS);
      pJob->GetState(&state);
    }

    return mResult;
  }

private:
  ULONG mRefCount;
  HANDLE mDoneEvent;
  HRESULT mResult;
};

static HRESULT
WaitForBITSJob(IBackgroundCopyJob* job)
{
  job->SetNotifyFlags(BG_NOTIFY_JOB_TRANSFERRED | BG_NOTIFY_JOB_ERROR);
  ComObjectWrapper<BitsListener> notifier(new BitsListener());
  job->SetNotifyInterface(notifier);

  job->Resume();
  HRESULT hr = notifier->WaitUntilFinished(job);

  // The error callback doesn't fire if the job was in a transient error state,
  // which means the error code wouldn't have been set properly.
  BG_JOB_STATE state;
  job->GetState(&state);
  if (state < BG_JOB_STATE_TRANSFERRED) {
    ComObjectWrapper<IBackgroundCopyError> error;
    job->GetError(&error);
    BG_ERROR_CONTEXT context;
    error->GetError(&context, &hr);

    job->Cancel();
  }

  return hr;
}

static HRESULT
CreateAndWaitForBITSJob(IBackgroundCopyManager* manager,
                        wchar_t const * url,
                        wchar_t const * dest)
{
  GUID jobid;
  ComObjectWrapper<IBackgroundCopyJob> job;
  HRESULT hr = manager->CreateJob(BITS_JOB_DISPLAY_NAME, BG_JOB_TYPE_DOWNLOAD,
                                  &jobid, &job);
  if (hr) {
    return hr;
  }

  hr = job->AddFile(url, dest);
  if (hr) {
    return hr;
  }

  return WaitForBITSJob(job);
}

int
DownloadFileInBackground(wchar_t const* url,
                         wchar_t const* dest)
{
  // Make sure COM gets uninitizlized whenever this function returns,
  // but after any COM objects are released.
  struct ComInitializer
  {
    ComInitializer()
    {
      CoInitializeEx(nullptr, COINIT_MULTITHREADED);
    }
    ~ComInitializer()
    {
      CoUninitialize();
    }
  } ci;

  ComObjectWrapper<IBackgroundCopyManager> bits;
  HRESULT hr = CoCreateInstance(
    __uuidof(BackgroundCopyManager),
    nullptr,
    CLSCTX_LOCAL_SERVER,
    __uuidof(IBackgroundCopyManager),
    (void**)&bits);
  if (FAILED(hr)) {
    return GetNSResult(hr);
  }

  // Look for a job that we created previously, so we can resume it.
  ComObjectWrapper<IEnumBackgroundCopyJobs> jobs;
  bits->EnumJobs(0, &jobs);
  ULONG jobsCount = 0;
  jobs->GetCount(&jobsCount);
  ComObjectWrapper<IBackgroundCopyJob> oldJob;
  for (ULONG i = 0; i < jobsCount; ++i) {
    ComObjectWrapper<IBackgroundCopyJob> job;
    jobs->Next(1, &job, nullptr);

    wchar_t* displayName;
    job->GetDisplayName(&displayName);
    if (!lstrcmpW(displayName, BITS_JOB_DISPLAY_NAME)) {
      CoTaskMemFree(displayName);
      oldJob = job;
      oldJob->AddRef();
      break;
    }
    CoTaskMemFree(displayName);
  }

  if (!oldJob) {
    hr = CreateAndWaitForBITSJob(bits, url, dest);
  } else {
    // See if this job is for the same URL this agent instance was passed.
    ComObjectWrapper<IEnumBackgroundCopyFiles> files;
    oldJob->EnumFiles(&files);
    ULONG filesCount = 0;
    files->GetCount(&filesCount);
    if (filesCount <= 0) {
      // No files at all, this must not be the job we're looking for.
      oldJob->Cancel();
      hr = CreateAndWaitForBITSJob(bits, url, dest);
    } else {
      ComObjectWrapper<IBackgroundCopyFile> file;
      files->Next(1, &file, nullptr);
      wchar_t* remoteName = nullptr;
      file->GetRemoteName(&remoteName);
      if (lstrcmpW(remoteName, url)) {
        // Different URL, so this job is out of date.
        oldJob->Cancel();
        hr = CreateAndWaitForBITSJob(bits, url, dest);
      } else {
        // Same URL, just resume and wait for the existing job.
        hr = WaitForBITSJob(oldJob);
      }
      CoTaskMemFree(remoteName);
    }
  }

  return GetNSResult(hr);
}
