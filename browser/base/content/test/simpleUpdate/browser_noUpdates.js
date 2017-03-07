add_task(function* testNoUpdates() {
  let updateParams = "noUpdates=1";

  yield runUpdateTest(updateParams, 1, []);

  yield sleep(100);

  is(PanelUI.activeNotification, null,
     "No notification should be present if there are no updates.")
});
