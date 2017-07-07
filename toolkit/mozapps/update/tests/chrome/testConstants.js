// MAR file URLs must be on 127.0.0.1 so that the update agent can access them;
// it doesn't get the proxy magic that makes e.g. example.com work.
const URL_HOST = "http://127.0.0.1:8888";
const REL_PATH_DATA = "chrome/toolkit/mozapps/update/tests/data/";
const URL_PATH_UPDATE_XML = "/chrome/toolkit/mozapps/update/tests/chrome/update.sjs";
const URL_HTTP_UPDATE_SJS = URL_HOST + URL_PATH_UPDATE_XML;
