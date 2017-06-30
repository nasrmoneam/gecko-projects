/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

function run_test() {
  setupTestCommon();
  start_httpserver();

  debugDump("testing resuming an update download in progress for the same " +
            "version of the application on startup (Bug 485624)");

  let patchProps = {state: STATE_DOWNLOADING, url: gURLData + FILE_SIMPLE_MAR};
  let patches = getLocalPatchString(patchProps);
  let updateProps = {appVersion: "1.0"};
  let updates = getLocalUpdateString(updateProps, patches);
  writeUpdatesToXMLFile(getLocalUpdatesXMLString(updates), true);
  writeStatusFile(STATE_DOWNLOADING);

  standardInit();

  Assert.equal(gUpdateManager.updateCount, 1,
               "the update manager updateCount attribute" + MSG_SHOULD_EQUAL);
  Assert.equal(gUpdateManager.activeUpdate.state, STATE_DOWNLOADING,
               "the update manager activeUpdate state attribute" +
               MSG_SHOULD_EQUAL);

  gCheckFunc = cleanup;
  gAUS.addDownloadListener(downloadListener);
}

function cleanup() {
  // Pause the download and reload the Update Manager with an empty update so
  // the Application Update Service doesn't write the update xml files during
  // xpcom-shutdown which will leave behind the test directory.
  gAUS.pauseDownload();
  writeUpdatesToXMLFile(getLocalUpdatesXMLString(""), true);
  writeUpdatesToXMLFile(getLocalUpdatesXMLString(""), false);
  reloadUpdateManagerData();

  stop_httpserver(doTestFinish);
}
