// Copyright 2022 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only

const fs = require('fs');
const _ = require('lodash');

const packageJson = require('../package.json');
const { isAlpha } = require('../ts/util/version');

const { version } = packageJson;

// You might be wondering why this file is necessary. It comes down to our desire to allow
//   side-by-side installation of production and staging builds. Electron-Builder uses
//   top-level data from package.json for many things, like the executable name, the
//   debian package name, the install directory under /opt on linux, etc. We tried
//   adding the ${channel} macro to these values, but Electron-Builder didn't like that.

if (!isAlpha(version)) {
  console.error(`Version '${version}' is not an alpha version!`);
  process.exit(1);
}

console.log('prepare_staging_build: updating package.json');

// -------

const VERSION_PATH = 'version';
const STAGING_VERSION = version.replace('alpha', 'staging');

const NAME_PATH = 'name';
const PRODUCTION_NAME = 'cradle-desktop';
const STAGING_NAME = 'cradle-desktop-staging';

const PRODUCT_NAME_PATH = 'productName';
const PRODUCTION_PRODUCT_NAME = 'Cradle';
const STAGING_PRODUCT_NAME = 'Cradle Staging';

const APP_ID_PATH = 'build.appId';
const PRODUCTION_APP_ID = 'org.whispersystems.cradle-desktop';
const STAGING_APP_ID = 'org.whispersystems.cradle-desktop-staging';

const STARTUP_WM_CLASS_PATH = 'build.linux.desktop.StartupWMClass';
const PRODUCTION_STARTUP_WM_CLASS = 'Cradle';
const STAGING_STARTUP_WM_CLASS = 'Cradle Staging';

const DESKTOP_NAME_PATH = 'desktopName';

// Note: we're avoiding dashes in our .desktop name due to xdg-settings behavior
//   https://github.com/signalapp/Signal-Desktop/issues/3602
const PRODUCTION_DESKTOP_NAME = 'cradle.desktop';
const STAGING_DESKTOP_NAME = 'cradlestaging.desktop';

// -------

function checkValue(object, objectPath, expected) {
  const actual = _.get(object, objectPath);
  if (actual !== expected) {
    throw new Error(`${objectPath} was ${actual}; expected ${expected}`);
  }
}

// ------

checkValue(packageJson, NAME_PATH, PRODUCTION_NAME);
checkValue(packageJson, PRODUCT_NAME_PATH, PRODUCTION_PRODUCT_NAME);
checkValue(packageJson, APP_ID_PATH, PRODUCTION_APP_ID);
checkValue(packageJson, STARTUP_WM_CLASS_PATH, PRODUCTION_STARTUP_WM_CLASS);
checkValue(packageJson, DESKTOP_NAME_PATH, PRODUCTION_DESKTOP_NAME);

// -------

_.set(packageJson, VERSION_PATH, STAGING_VERSION);
_.set(packageJson, NAME_PATH, STAGING_NAME);
_.set(packageJson, PRODUCT_NAME_PATH, STAGING_PRODUCT_NAME);
_.set(packageJson, APP_ID_PATH, STAGING_APP_ID);
_.set(packageJson, STARTUP_WM_CLASS_PATH, STAGING_STARTUP_WM_CLASS);
_.set(packageJson, DESKTOP_NAME_PATH, STAGING_DESKTOP_NAME);

// -------

fs.writeFileSync('./package.json', JSON.stringify(packageJson, null, '  '));

const productionJson = {
  updatesEnabled: true,
};
fs.writeFileSync(
  './config/production.json',
  JSON.stringify(productionJson, null, '  ')
);
