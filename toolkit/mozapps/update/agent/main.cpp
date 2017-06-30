/* -*- Mode: C++; tab-width: 2; indent-tabs-mode: nil; c-basic-offset: 2 -*- */
/* vim:set ts=2 sw=2 sts=2 et cindent: */
/* This Source Code Form is subject to the terms of the Mozilla Public
* License, v. 2.0. If a copy of the MPL was not distributed with this
* file, You can obtain one at http://mozilla.org/MPL/2.0/. */

#include <string.h>
#include <stdio.h>
#include "mozilla/UniquePtr.h"
#include "errors.h"
#include "updatecommon.h"

#if defined(XP_WIN)
  #include <windows.h>
  #define NS_main wmain
#else
  #define NS_main main
#endif

#define ERROR_PARAMETER_MISSING -1
#define ERROR_UNKNOWN_PARAMETER -2
#define ERROR_NO_DESTINATION_DIR -3

NS_tchar *gUpdatesDir = nullptr;
NS_tchar *gDownloadURL = nullptr;

// This function is defined in a set of platform-specific source files, because
// the entire implementation is platform-specific.
int DownloadFileInBackground(NS_tchar const* url, NS_tchar const* dest);

static bool
WriteStatusFile(const char* aStatus)
{
  NS_tchar filename[MAXPATHLEN] = NS_T("");
#if defined(XP_WIN)
  GetTempFileNameW(gUpdatesDir, L"sta", 0, filename);
#else
  NS_tsnprintf(filename, sizeof(filename)/sizeof(filename[0]),
               NS_T("%s/update.status"), gUpdatesDir);
#endif

  // This is scoped to make the AutoFile close the file so it is possible to
  // move the temp file to the update.status file on Windows.
  {
    AutoFile file(NS_tfopen(filename, NS_T("wb+")));
    if (!file) {
      return false;
    }

    if (fwrite(aStatus, strlen(aStatus), 1, file) != 1) {
      return false;
    }
  }

#if defined(XP_WIN)
  NS_tchar dstfilename[MAXPATHLEN] = NS_T("");
  NS_tsnprintf(dstfilename, sizeof(dstfilename)/sizeof(dstfilename[0]),
               NS_T("%s\\update.status"), gUpdatesDir);
  if (MoveFileExW(filename, dstfilename, MOVEFILE_REPLACE_EXISTING) == 0) {
    DeleteFile(filename);
    return false;
  }
#endif

  return true;
}

static bool
WriteStatusFile(const char* errorString, int errorCode)
{
  // We'll need to write the length of the error string, plus the length of
  // ": ", plus the maximum length of a 64-bit integer written in decimal
  int length = strlen(errorString) + 2 + 20;
  mozilla::UniquePtr<char> str = mozilla::MakeUnique<char>(length + 1);

  sprintf(str.get(), "%s: %d", errorString, errorCode);

  return WriteStatusFile(str.get());
}

static int
ParseCommandLine(int argc, NS_tchar** const argv)
{
  if (argc < 5) {
    return ERROR_PARAMETER_MISSING;
  }

  for (int i = 1; i < argc; ++i) {
    if (!NS_tstrcmp(argv[i], NS_T("-d")) && i < (argc - 1)) {
      ++i;
      gUpdatesDir = argv[i];
    } else if (!NS_tstrcmp(argv[i], NS_T("-u")) && i < (argc - 1)) {
      ++i;
      gDownloadURL = argv[i];
    } else {
      return ERROR_UNKNOWN_PARAMETER;
    }
  }

  if (gUpdatesDir == nullptr || gDownloadURL == nullptr) {
    return ERROR_PARAMETER_MISSING;
  }

  return OK;
}

int
NS_main(int argc, NS_tchar** argv)
{
  int rv = ParseCommandLine(argc, argv);
  if (rv) {
    return rv;
  }

  NS_tchar dest[MAXPATHLEN] = NS_T("");
  NS_tsnprintf(dest, MAXPATHLEN, NS_T("%s/update.mar"), gUpdatesDir);
  
  if (ensure_parent_dir(dest)) {
    return ERROR_NO_DESTINATION_DIR;
  }

  WriteStatusFile("downloading");
  rv = DownloadFileInBackground(gDownloadURL, dest);
  if (!rv) {
    WriteStatusFile("pending");
  } else {
    WriteStatusFile("download-failed", rv);  
  }
  
  return rv;
}
