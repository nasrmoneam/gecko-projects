/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/* General MAR File Download Tests */

function run_test() {
  setupTestCommon();

  debugDump("testing recovery of mar download after interrupting the agent");

  Services.prefs.setBoolPref(PREF_APP_UPDATE_STAGING_ENABLED, false);
  start_httpserver({slowDownload: true});
  setUpdateURL(gURLData + gHTTPHandlerPath);
  standardInit();

  let patches = getRemotePatchString({});
  let updates = getRemoteUpdateString({}, patches);
  gResponseBody = getRemoteUpdatesXMLString(updates);

  gUpdates = null;
  gUpdateCount = null;
  gStatusResult = null;
  gCheckFunc = downloadUpdate;
  gUpdateChecker.checkForUpdates(updateCheckListener, true);
}

// The HttpServer must be stopped before calling do_test_finished
function finish_test() {
  stop_httpserver(doTestFinish);
}

class TestDownloadListener {
  onStartRequest(aRequest, aContext) {
    do_execute_soon(() => {
      gAUS.pauseDownload();
      resumeDownload();
    });
  }

  onStatus(aRequest, aContext, aStatus, aStatusText) { }

  onProgress(aRequest, aContext, aProgress, aMaxProgress) { }

  onStopRequest(aRequest, aContext, aStatus) {
    Assert.equal(gBestUpdate.state, STATE_PENDING,
                 "the update state" + MSG_SHOULD_EQUAL);
    Assert.equal(aStatus, Cr.NS_OK, "the download status" + MSG_SHOULD_EQUAL);
    do_execute_soon(finish_test);
  }

  QueryInterface(iid) {
    if (iid.equals(Ci.nsIRequestObserver) ||
        iid.equals(Ci.nsIProgressEventSink)) {
      return this;
    }
    throw Cr.NS_ERROR_NO_INTERFACE;
  }
}

let gBestUpdate;
let gListener = new TestDownloadListener();

function downloadUpdate() {
  Assert.equal(gUpdateCount, 1, "the update count" + MSG_SHOULD_EQUAL);
  gBestUpdate = gAUS.selectUpdate(gUpdates, gUpdateCount);
  let state = gAUS.downloadUpdate(gBestUpdate, false);
  if (state == STATE_NONE || state == STATE_FAILED) {
    do_throw("nsIApplicationUpdateService:downloadUpdate returned " + state);
  }
  gAUS.addDownloadListener(gListener);
}

function resumeDownload() {
  // Wait a moment for the agent process to be killed and restarted.
  // Since this is a retry of the download, there's no event we can wait on.
  do_timeout(5000, function() {
    gSlowDownloadContinue = true;

    // Resuming creates a new Downloader, and thus drops registered listeners.
    gAUS.addDownloadListener(gListener);
  });
}
