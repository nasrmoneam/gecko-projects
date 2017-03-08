Cu.import("resource://gre/modules/FileUtils.jsm");
Cu.import("resource://gre/modules/XPCOMUtils.jsm");

const IS_MACOSX = ("nsILocalFileMac" in Ci);
const IS_WIN = ("@mozilla.org/windows-registry-key;1" in Cc);

const KEY_UPDROOT         = "UpdRootD";

const PREF_APP_UPDATE_LOG                            = "app.update.log";
const PREF_APP_UPDATE_URL                            = "app.update.url";
const PREF_APP_UPDATE_DOORHANGER                     = "app.update.doorhanger";
const PREF_APP_UPDATE_CHANNEL                        = "app.update.channel";
const PREF_APP_UPDATE_ENABLED                        = "app.update.enabled";
const PREF_APP_UPDATE_IDLETIME                       = "app.update.idletime";
const PREF_APP_UPDATE_URL_DETAILS                    = "app.update.url.details";
const PREF_APP_UPDATE_URL_MANUAL                     = "app.update.url.manual";
const PREF_APP_UPDATE_STAGING_ENABLED                = "app.update.staging.enabled";
const PREF_APP_UPDATE_BACKGROUNDMAXERRORS            = "app.update.backgroundMaxErrors";
const PREF_APP_UPDATE_DOWNLOADPROMPTATTEMPTS         = "app.update.download.promptAttempts";
const PREF_APP_UPDATE_DOWNLOADPROMPTMAXATTEMPTS      = "app.update.download.promptMaxAttempts";

const NS_APP_PROFILE_DIR_STARTUP   = "ProfDS";
const NS_APP_USER_PROFILE_50_DIR   = "ProfD";
const NS_GRE_DIR                   = "GreD";
const NS_GRE_BIN_DIR               = "GreBinD";
const NS_XPCOM_CURRENT_PROCESS_DIR = "XCurProcD";
const XRE_EXECUTABLE_FILE          = "XREExeF";
const XRE_UPDATE_ROOT_DIR          = "UpdRootD";

const DIR_PATCH        = "0";
const DIR_TOBEDELETED  = "tobedeleted";
const DIR_UPDATES      = "updates";
const DIR_UPDATED      = IS_MACOSX ? "Updated.app" : "updated";

const BIN_SUFFIX = (IS_WIN ? ".exe" : "");
const FILE_UPDATER_BIN = "updater" + (IS_MACOSX ? ".app" : BIN_SUFFIX);
const FILE_UPDATER_BIN_BAK = FILE_UPDATER_BIN + ".bak";

const FILE_ACTIVE_UPDATE_XML         = "active-update.xml";
const FILE_APPLICATION_INI           = "application.ini";
const FILE_BACKUP_UPDATE_LOG         = "backup-update.log";
const FILE_LAST_UPDATE_LOG           = "last-update.log";
const FILE_UPDATE_SETTINGS_INI       = "update-settings.ini";
const FILE_UPDATE_SETTINGS_INI_BAK   = "update-settings.ini.bak";
const FILE_UPDATER_INI               = "updater.ini";
const FILE_UPDATES_XML               = "updates.xml";
const FILE_UPDATE_LOG                = "update.log";
const FILE_UPDATE_MAR                = "update.mar";
const FILE_UPDATE_STATUS             = "update.status";
const FILE_UPDATE_TEST               = "update.test";
const FILE_UPDATE_VERSION            = "update.version";

const PERMS_FILE      = FileUtils.PERMS_FILE;
const PERMS_DIRECTORY = FileUtils.PERMS_DIRECTORY;

const UPDATE_SETTINGS_CONTENTS = "[Settings]\n" +
                                 "ACCEPTED_MAR_CHANNEL_IDS=xpcshell-test\n";

const PR_RDWR        = 0x04;
const PR_CREATE_FILE = 0x08;
const PR_TRUNCATE    = 0x20;

const DEFAULT_UPDATE_VERSION = "999999.0";

let gRembemberedPrefs = [];

const DATA_URI_SPEC =  "chrome://mochitests/content/browser/browser/base/content/test/appUpdate/";

var DEBUG_AUS_TEST = true;
var gUseTestUpdater = false;

/* import-globals-from testConstants.js */
Services.scriptloader.loadSubScript(DATA_URI_SPEC + "testConstants.js", this);
/* import-globals-from sharedUpdateXML.js */
Services.scriptloader.loadSubScript(DATA_URI_SPEC + "sharedUpdateXML.js", this);

var gURLData = URL_HOST + "/" + REL_PATH_DATA;
const URL_MANUAL_UPDATE = gURLData + "downloadPage.html";

const NOTIFICATIONS = [
  "update-available",
  "update-manual",
  "update-restart"
];

XPCOMUtils.defineLazyGetter(this, "gUpdateService", function test_gAUS() {
  return Cc["@mozilla.org/updates/update-service;1"].
         getService(Ci.nsIApplicationUpdateService).
         QueryInterface(Ci.nsITimerCallback).
         QueryInterface(Ci.nsIObserver).
         QueryInterface(Ci.nsIUpdateCheckListener);
});

XPCOMUtils.defineLazyServiceGetter(this, "gUpdateManager",
                                   "@mozilla.org/updates/update-manager;1",
                                   "nsIUpdateManager");

XPCOMUtils.defineLazyGetter(this, "gDefaultPrefBranch", function test_gDPB() {
  return Services.prefs.getDefaultBranch(null);
});


function delay() {
  return new Promise(resolve => executeSoon(resolve));
}

/**
 * Sets the app.update.url default preference.
 *
 * @param  aURL
 *         The update url. If not specified 'URL_HOST + "/update.xml"' will be
 *         used.
 */
function setUpdateURL(aURL) {
  let url = aURL ? aURL : URL_HOST + "/update.xml";
  pushPref("Char", PREF_APP_UPDATE_URL, url, gDefaultPrefBranch);
}

/**
 * Gets the update version info for the update url parameters to send to
 * update.sjs.
 *
 * @param  aAppVersion (optional)
 *         The application version for the update snippet. If not specified the
 *         current application version will be used.
 * @return The url parameters for the application and platform version to send
 *         to update.sjs.
 */
function getVersionParams(aAppVersion) {
  let appInfo = Services.appinfo;
  return "&appVersion=" + (aAppVersion ? aAppVersion : appInfo.version);
}

/**
 * Removes the updates.xml file, active-update.xml file, and all files and
 * sub-directories in the updates directory except for the "0" sub-directory.
 * This prevents some tests from failing due to files being left behind when the
 * tests are interrupted.
 */
function removeUpdateDirsAndFiles() {
  let file = getUpdatesXMLFile(true);
  try {
    if (file.exists()) {
      file.remove(false);
    }
  } catch (e) {
    logTestInfo("Unable to remove file. Path: " + file.path +
                ", Exception: " + e);
  }

  file = getUpdatesXMLFile(false);
  try {
    if (file.exists()) {
      file.remove(false);
    }
  } catch (e) {
    logTestInfo("Unable to remove file. Path: " + file.path +
                ", Exception: " + e);
  }

  // This fails sporadically on Mac OS X so wrap it in a try catch
  let updatesDir = getUpdatesDir();
  try {
    cleanUpdatesDir(updatesDir);
  } catch (e) {
    logTestInfo("Unable to remove files / directories from directory. Path: " +
                updatesDir.path + ", Exception: " + e);
  }
}

/**
 * Removes all files and sub-directories in the updates directory except for
 * the "0" sub-directory.
 *
 * @param  aDir
 *         nsIFile for the directory to be deleted.
 */
function cleanUpdatesDir(aDir) {
  if (!aDir.exists()) {
    return;
  }

  let dirEntries = aDir.directoryEntries;
  while (dirEntries.hasMoreElements()) {
    let entry = dirEntries.getNext().QueryInterface(Ci.nsIFile);

    if (entry.isDirectory()) {
      if (entry.leafName == DIR_PATCH && entry.parent.leafName == DIR_UPDATES) {
        cleanUpdatesDir(entry);
        entry.permissions = PERMS_DIRECTORY;
      } else {
        try {
          entry.remove(true);
          return;
        } catch (e) {
        }
        cleanUpdatesDir(entry);
        entry.permissions = PERMS_DIRECTORY;
        try {
          entry.remove(true);
        } catch (e) {
          logTestInfo("cleanUpdatesDir: unable to remove directory. Path: " +
                      entry.path + ", Exception: " + e);
          throw (e);
        }
      }
    } else {
      entry.permissions = PERMS_FILE;
      try {
        entry.remove(false);
      } catch (e) {
        logTestInfo("cleanUpdatesDir: unable to remove file. Path: " +
                    entry.path + ", Exception: " + e);
        throw (e);
      }
    }
  }
}

/**
 * Deletes a directory and its children. First it tries nsIFile::Remove(true).
 * If that fails it will fall back to recursing, setting the appropriate
 * permissions, and deleting the current entry.
 *
 * @param  aDir
 *         nsIFile for the directory to be deleted.
 */
function removeDirRecursive(aDir) {
  if (!aDir.exists()) {
    return;
  }

  try {
    debugDump("attempting to remove directory. Path: " + aDir.path);
    aDir.remove(true);
    return;
  } catch (e) {
    logTestInfo("non-fatal error removing directory. Exception: " + e);
  }

  let dirEntries = aDir.directoryEntries;
  while (dirEntries.hasMoreElements()) {
    let entry = dirEntries.getNext().QueryInterface(Ci.nsIFile);

    if (entry.isDirectory()) {
      removeDirRecursive(entry);
    } else {
      entry.permissions = PERMS_FILE;
      try {
        debugDump("attempting to remove file. Path: " + entry.path);
        entry.remove(false);
      } catch (e) {
        logTestInfo("error removing file. Exception: " + e);
        throw (e);
      }
    }
  }

  aDir.permissions = PERMS_DIRECTORY;
  aDir.remove(true);
}

/* Reloads the update metadata from disk */
function reloadUpdateManagerData() {
  gUpdateManager.QueryInterface(Ci.nsIObserver).
  observe(null, "um-reload-update-data", "");
}

/**
 * Returns the Gecko Runtime Engine directory where files other than executable
 * binaries are located. On Mac OS X this will be <bundle>/Contents/Resources/
 * and the installation directory on all other platforms.
 *
 * @return nsIFile for the Gecko Runtime Engine directory.
 */
function getGREDir() {
  return Services.dirsvc.get(NS_GRE_DIR, Ci.nsIFile);
}

/**
 * Gets the application base directory.
 *
 * @return  nsIFile object for the application base directory.
 */
function getAppBaseDir() {
  return Services.dirsvc.get(XRE_EXECUTABLE_FILE, Ci.nsIFile).parent;
}

/**
 * Logs TEST-INFO messages when DEBUG_AUS_TEST evaluates to true.
 *
 * @param  aText
 *         The text to log.
 * @param  aCaller (optional)
 *         An optional Components.stack.caller. If not specified
 *         Components.stack.caller will be used.
 */
function debugDump(aText, aCaller) {
  if (DEBUG_AUS_TEST) {
    let caller = aCaller ? aCaller : Components.stack.caller;
    logTestInfo(aText, caller);
  }
}

/**
 * Returns either the active or regular update database XML file.
 *
 * @param  isActiveUpdate
 *         If true this will return the active-update.xml otherwise it will
 *         return the updates.xml file.
 */
function getUpdatesXMLFile(aIsActiveUpdate) {
  let file = getUpdatesRootDir();
  file.append(aIsActiveUpdate ? FILE_ACTIVE_UPDATE_XML : FILE_UPDATES_XML);
  return file;
}

/**
 * Gets the root directory for the updates directory.
 *
 * @return nsIFile for the updates root directory.
 */
function getUpdatesRootDir() {
  return Services.dirsvc.get(XRE_UPDATE_ROOT_DIR, Ci.nsIFile);
}

/**
 * Gets the updates directory.
 *
 * @return nsIFile for the updates directory.
 */
function getUpdatesDir() {
  let dir = getUpdatesRootDir();
  dir.append(DIR_UPDATES);
  return dir;
}

/**
 * Gets the directory for update patches.
 *
 * @return nsIFile for the updates directory.
 */
function getUpdatesPatchDir() {
  let dir = getUpdatesDir();
  dir.append(DIR_PATCH);
  return dir;
}

/**
 * Logs TEST-INFO messages.
 *
 * @param  aText
 *         The text to log.
 * @param  aCaller (optional)
 *         An optional Components.stack.caller. If not specified
 *         Components.stack.caller will be used.
 */
function logTestInfo(aText, aCaller) {
  let caller = aCaller ? aCaller : Components.stack.caller;
  let now = new Date();
  let hh = now.getHours();
  let mm = now.getMinutes();
  let ss = now.getSeconds();
  let ms = now.getMilliseconds();
  let time = (hh < 10 ? "0" + hh : hh) + ":" +
             (mm < 10 ? "0" + mm : mm) + ":" +
             (ss < 10 ? "0" + ss : ss) + ":";
  if (ms < 10) {
    time += "00";
  } else if (ms < 100) {
    time += "0";
  }
  time += ms;
  let msg = time + " | TEST-INFO | " + caller.filename + " | [" + caller.name +
            " : " + caller.lineNumber + "] " + aText;
  info(msg);
}

/**
 * Clean up updates list and the updates directory.
 */
function cleanUpUpdates() {
  gUpdateManager.activeUpdate = null;
  gUpdateManager.saveUpdates();

  removeUpdateDirsAndFiles();
}

function sleep(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

function runUpdateTest(updateParams, checkAttempts, steps) {
  return Task.spawn(function*() {
    registerCleanupFunction(() => {
      popPrefs();
      gMenuButtonUpdateBadge.uninit();
      gMenuButtonUpdateBadge.init();
      cleanUpUpdates();
    });

    pushPref("Int", PREF_APP_UPDATE_DOWNLOADPROMPTATTEMPTS, 0);
    pushPref("Bool", PREF_APP_UPDATE_ENABLED, true);
    pushPref("Int", PREF_APP_UPDATE_IDLETIME, 0);
    pushPref("Char", PREF_APP_UPDATE_URL_MANUAL, URL_MANUAL_UPDATE);
    if (DEBUG_AUS_TEST) {
      pushPref("Bool", PREF_APP_UPDATE_LOG, true);
    }

    yield setupTestUpdater();

    let url = URL_HTTP_UPDATE_SJS +
              "?" + updateParams +
              getVersionParams();

    setUpdateURL(url);

    executeSoon(() => {
      Task.spawn(function*() {
        gUpdateService.checkForBackgroundUpdates();
        for (var i = 0; i < checkAttempts - 1; i++) {
          yield waitForEvent("update-error", "check-attempt-failed");
          gUpdateService.checkForBackgroundUpdates();
        }
      });
    });

    for (let step of steps) {
      yield processStep(step);
    }

    yield finishTestRestoreUpdaterBackup();
  });
}

function runUpdateProcessingTest(updates, steps) {
  return Task.spawn(function*() {
    registerCleanupFunction(() => {
      popPrefs();
      gMenuButtonUpdateBadge.reset();
      cleanUpUpdates();
    });

    pushPref("Int", PREF_APP_UPDATE_DOWNLOADPROMPTATTEMPTS, 0);
    pushPref("Bool", PREF_APP_UPDATE_ENABLED, true);
    pushPref("Int", PREF_APP_UPDATE_IDLETIME, 0);
    pushPref("Char", PREF_APP_UPDATE_URL_MANUAL, URL_MANUAL_UPDATE);
    pushPref("Bool", PREF_APP_UPDATE_ENABLED, true);
    if (DEBUG_AUS_TEST) {
      pushPref("Bool", PREF_APP_UPDATE_LOG, true);
    }

    yield setupTestUpdater();

    writeUpdatesToXMLFile(getLocalUpdatesXMLString(updates), true);

    writeUpdatesToXMLFile(getLocalUpdatesXMLString(""), false);
    writeStatusFile(STATE_FAILED_CRC_ERROR);
    reloadUpdateManagerData();

    testPostUpdateProcessing();

    for (let step of steps) {
      yield processStep(step);
    }

    yield finishTestRestoreUpdaterBackup();
  });
}

function removeUpdateFile(name) {
  let versionFile = FileUtils.getDir(KEY_UPDROOT, ["updates", "0"], true).clone();
  versionFile.append(name);

  if (versionFile.exists()) {
    versionFile.remove(false);
  }
}

/**
 * Writes the updates specified to either the active-update.xml or the
 * updates.xml.
 *
 * @param  aContent
 *         The updates represented as a string to write to the XML file.
 * @param  isActiveUpdate
 *         If true this will write to the active-update.xml otherwise it will
 *         write to the updates.xml file.
 */
function writeUpdatesToXMLFile(aContent, aIsActiveUpdate) {
  writeStringToFile(getUpdatesXMLFile(aIsActiveUpdate), aContent);
}

/**
 * Writes the current update operation/state to a file in the patch
 * directory, indicating to the patching system that operations need
 * to be performed.
 *
 * @param  aStatus
 *         The status value to write.
 */
function writeStatusFile(aStatus) {
  let file = getUpdatesPatchDir();
  file.append(FILE_UPDATE_STATUS);
  writeStringToFile(file, aStatus + "\n");
}

/**
 * Writes a string of text to a file.  A newline will be appended to the data
 * written to the file.  This function only works with ASCII text.
 */
function writeStringToFile(file, text) {
  let fos = FileUtils.openSafeFileOutputStream(file);
  text += "\n";
  try {
    fos.write(text, text.length);
  } catch (e) {
    throw new Error(`Error writing file: [${file.path}]. Message: ${e}`);
  }
  FileUtils.closeSafeFileOutputStream(fos);
}

function processStep({notificationId, button, beforeClick, cleanup}) {
  return Task.spawn(function*() {
    yield waitForEvent(`panelUI-${notificationId}`, "doorhanger-shown");

    let notification = document.getElementById(`PanelUI-${notificationId}-notification`);
    is(notification.hidden, false, `${notificationId} notification is showing`);
    if (beforeClick) {
      yield Task.spawn(beforeClick);
    }

    let buttonEl = document.getAnonymousElementByAttribute(notification, "anonid", button);

    buttonEl.click();

    if (cleanup) {
      yield Task.spawn(cleanup);
    }
  });
}

/**
 * Sets a preference's value in a way that it is remembered and can be set back to what it
 * was previously.
 *
 * @param  type
 *         {Int, Char, Bool, etc.} as in getCharPref.
 * @param  name
 *         The name of the preference.
 * @param  value
 *         The value to temporarily give the preference.
 * @param  prefBranch
 *         Optional pref branch to use.
 */
function pushPref(type, name, value, prefBranch) {
  if (!prefBranch) {
    prefBranch = Services.prefs;
  }

  let oldValue;
  try {
    oldValue = prefBranch[`get${type}Pref`](name);
  } catch (e) {
    oldValue = null;
  }
  gRembemberedPrefs.push({type, name, oldValue, prefBranch});

  prefBranch[`set${type}Pref`](name, value);
}

function popPrefs() {
  for (let {type, name, oldValue, prefBranch} of gRembemberedPrefs.reverse()) {
    if (oldValue === null) {
      prefBranch.clearUserPref(name);
    } else {
      prefBranch[`set${type}Pref`](name, oldValue);
    }
  }

  gRembemberedPrefs = [];
}

function popPref(name) {
  let remembered = gRembemberedPrefs.reverse().find(p => p.name == name);
  if (remembered) {
    let {type, oldValue} = remembered;

    if (oldValue === null) {
      Services.prefs.clearUserPref(name);
    } else {
      Services.prefs[`set${type}Pref`](name, oldValue);
    }

    gRembemberedPrefs = gRembemberedPrefs.slice(gRembemberedPrefs.indexOf(remembered), 1);
  }
}

/**
 * Waits for the specified topic and (optionally) status.
 * @param  topic
 *         String representing the topic to wait for.
 * @param  status
 *         Optional String representing the status on said topic to wait for.
 * @return A promise which will resolve the first time an event occurs on the specified
 *         topic, and (optionally) with the specified status.
 */
function waitForEvent(topic, status = null) {
  return new Promise(resolve => Services.obs.addObserver({
    observe(subject, innerTopic, innerStatus) {
      if (!status || status == innerStatus) {
        Services.obs.removeObserver(this, topic);
        resolve(topic);
      }
    }
  }, topic, false))
}

/* Triggers post-update processing */
function testPostUpdateProcessing() {
  gUpdateService.observe(null, "test-post-update-processing", "");
}

function addWindowListener(aURL, aCallback) {
}

/**
 * Waits for a window with the specified url to load.
 *
 * @param  url
 *         The url to wait for.
 * @return A promise which will resolve when a window with the specified url is loaded.
 *         If another url is loaded, this will result in an assertion failure.
 */
function waitForWindow(url) {
  return new Promise(resolve => {
    Services.wm.addListener({
      onOpenWindow(xulWindow) {
        info("window opened, waiting for focus");
        Services.wm.removeListener(this);

        var domwindow = xulWindow.QueryInterface(Ci.nsIInterfaceRequestor)
                                 .getInterface(Ci.nsIDOMWindow);
        waitForFocus(function() {
          is(domwindow.document.location.href, url, "should have seen the right window open");
          resolve(domwindow);
        }, domwindow);
      },
      onCloseWindow(xulWindow) { },
      onWindowTitleChange(xulWindow, newTitle) { }
    });
  })
}

/**
 * Constructs a string representing an update element for a local update xml
 * file. See getUpdateString for parameter information not provided below.
 *
 * @param  aPatches
 *         String representing the application update patches.
 * @param  aServiceURL (optional)
 *         The update's xml url.
 *         If not specified it will default to 'http://test_service/'.
 * @param  aIsCompleteUpdate (optional)
 *         The string 'true' if this update was a complete update or the string
 *         'false' if this update was a partial update.
 *         If not specified it will default to 'true'.
 * @param  aChannel (optional)
 *         The update channel name.
 *         If not specified it will default to the default preference value of
 *         app.update.channel.
 * @param  aForegroundDownload (optional)
 *         The string 'true' if this update was manually downloaded or the
 *         string 'false' if this update was automatically downloaded.
 *         If not specified it will default to 'true'.
 * @param  aPreviousAppVersion (optional)
 *         The application version prior to applying the update.
 *         If not specified it will not be present.
 * @return The string representing an update element for an update xml file.
 */
function getLocalUpdateString(aPatches, aType, aName, aDisplayVersion,
                              aAppVersion, aBuildID, aDetailsURL, aServiceURL,
                              aInstallDate, aStatusText, aIsCompleteUpdate,
                              aChannel, aForegroundDownload, aShowPrompt,
                              aShowNeverForVersion, aPromptWaitTime,
                              aBackgroundInterval, aPreviousAppVersion,
                              aCustom1, aCustom2) {
  let serviceURL = aServiceURL ? aServiceURL : "http://test_service/";
  let installDate = aInstallDate ? aInstallDate : "1238441400314";
  let statusText = aStatusText ? aStatusText : "Install Pending";
  let isCompleteUpdate =
    typeof aIsCompleteUpdate == "string" ? aIsCompleteUpdate : "true";
  let channel = aChannel ? aChannel
                         : gDefaultPrefBranch.getCharPref(PREF_APP_UPDATE_CHANNEL);
  let foregroundDownload =
    typeof aForegroundDownload == "string" ? aForegroundDownload : "true";
  let previousAppVersion = aPreviousAppVersion ? "previousAppVersion=\"" +
                                                 aPreviousAppVersion + "\" "
                                               : "";
  return getUpdateString(aType, aName, aDisplayVersion, aAppVersion, aBuildID,
                         aDetailsURL, aShowPrompt, aShowNeverForVersion,
                         aPromptWaitTime, aBackgroundInterval, aCustom1, aCustom2) +
                   " " +
                   previousAppVersion +
                   "serviceURL=\"" + serviceURL + "\" " +
                   "installDate=\"" + installDate + "\" " +
                   "statusText=\"" + statusText + "\" " +
                   "isCompleteUpdate=\"" + isCompleteUpdate + "\" " +
                   "channel=\"" + channel + "\" " +
                   "foregroundDownload=\"" + foregroundDownload + "\">" +
              aPatches +
         "  </update>";
}

function checkWhatsNewLink(id, url) {
  let whatsNewLink = document.getElementById(id);
  is(whatsNewLink.href,
     url || URL_HTTP_UPDATE_SJS + "?uiURL=DETAILS",
     "What's new link points to the test_details URL");
  is(whatsNewLink.hidden, false, "What's new link is not hidden.");
}

/**
 * For tests that use the test updater restores the backed up real updater if
 * it exists and tries again on failure since Windows debug builds at times
 * leave the file in use. After success moveRealUpdater is called to continue
 * the setup of the test updater. For tests that don't use the test updater
 * runTest will be called.
 */
function setupTestUpdater() {
  return Task.spawn(function*() {
    if (gUseTestUpdater) {
      try {
        restoreUpdaterBackup();
      } catch (e) {
        logTestInfo("Attempt to restore the backed up updater failed... " +
                    "will try again, Exception: " + e);
        yield delay();
        yield setupTestUpdater();
        return;
      }
      yield moveRealUpdater();
    }
  });
}

/**
 * Backs up the real updater and tries again on failure since Windows debug
 * builds at times leave the file in use. After success it will call
 * copyTestUpdater to continue the setup of the test updater.
 */
function moveRealUpdater() {
  return Task.spawn(function*() {
    try {
      // Move away the real updater
      let baseAppDir = getAppBaseDir();
      let updater = baseAppDir.clone();
      updater.append(FILE_UPDATER_BIN);
      updater.moveTo(baseAppDir, FILE_UPDATER_BIN_BAK);
    } catch (e) {
      logTestInfo("Attempt to move the real updater out of the way failed... " +
                  "will try again, Exception: " + e);
      yield delay();
      yield moveRealUpdater();
      return;
    }

    yield copyTestUpdater();
  });
}

/**
 * Copies the test updater so it can be used by tests and tries again on failure
 * since Windows debug builds at times leave the file in use. After success it
 * will call runTest to continue the test.
 */
function copyTestUpdater() {
  return Task.spawn(function*() {
    try {
      // Copy the test updater
      let baseAppDir = getAppBaseDir();
      let testUpdaterDir = Services.dirsvc.get("CurWorkD", Ci.nsILocalFile);
      let relPath = REL_PATH_DATA;
      let pathParts = relPath.split("/");
      for (let i = 0; i < pathParts.length; ++i) {
        testUpdaterDir.append(pathParts[i]);
      }

      let testUpdater = testUpdaterDir.clone();
      testUpdater.append(FILE_UPDATER_BIN);
      testUpdater.copyToFollowingLinks(baseAppDir, FILE_UPDATER_BIN);
    } catch (e) {
      logTestInfo("Attempt to copy the test updater failed... " +
                  "will try again, Exception: " + e);
      yield delay();
      yield copyTestUpdater();
    }
  });
}

/**
 * Restores the updater that was backed up. This is called in setupTestUpdater
 * before the backup of the real updater is done in case the previous test
 * failed to restore the updater, in finishTestDefaultWaitForWindowClosed when
 * the test has finished, and in test_9999_cleanup.xul after all tests have
 * finished.
 */
function restoreUpdaterBackup() {
  let baseAppDir = getAppBaseDir();
  let updater = baseAppDir.clone();
  let updaterBackup = baseAppDir.clone();
  updater.append(FILE_UPDATER_BIN);
  updaterBackup.append(FILE_UPDATER_BIN_BAK);
  if (updaterBackup.exists()) {
    if (updater.exists()) {
      updater.remove(true);
    }
    updaterBackup.moveTo(baseAppDir, FILE_UPDATER_BIN);
  }
}

/**
 * When a test finishes this will repeatedly attempt to restore the real updater
 * for tests that use the test updater and then call
 * finishTestDefaultWaitForWindowClosed after the restore is successful.
 */
function finishTestRestoreUpdaterBackup() {
  return Task.spawn(function*() {
    if (gUseTestUpdater) {
      try {
        // Windows debug builds keep the updater file in use for a short period of
        // time after the updater process exits.
        restoreUpdaterBackup();
      } catch (e) {
        logTestInfo("Attempt to restore the backed up updater failed... " +
                    "will try again, Exception: " + e);

        yield delay();
        yield finishTestRestoreUpdaterBackup();
        return;
      }
    }
  });
}