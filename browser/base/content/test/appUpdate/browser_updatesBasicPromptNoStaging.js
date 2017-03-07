add_task(function* testBasicPromptNoStaging() {
  pushPref("Bool", PREF_APP_UPDATE_STAGING_ENABLED, false);

  let updateParams = "showPrompt=1&promptWaitTime=0";

  yield runUpdateTest(updateParams, 1, [
    {
      notificationId: "update-available",
      button: "button",
      beforeClick() {
        checkWhatsNewLink("update-available-whats-new");
      }
    },
    {
      notificationId: "update-restart",
      button: "secondarybutton",
      cleanup() {
        PanelUI.removeNotification(/.*/);
      }
    },
  ]);

  popPref(PREF_APP_UPDATE_STAGING_ENABLED);
});
