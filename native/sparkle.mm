#include <node_api.h>

#import <Cocoa/Cocoa.h>
#import <Sparkle/Sparkle.h>

static SPUStandardUpdaterController *updaterController;
static napi_env scheduledUpdateEnv;
static napi_ref scheduledUpdateCallback;

@interface AMDMUpdaterDelegate : NSObject <SPUStandardUserDriverDelegate>
@end

@implementation AMDMUpdaterDelegate

- (BOOL)supportsGentleScheduledUpdateReminders {
  return YES;
}

- (BOOL)standardUserDriverShouldHandleShowingScheduledUpdate:(SUAppcastItem *)update
                                          andInImmediateFocus:(BOOL)immediateFocus {
  return NO;
}

- (void)standardUserDriverWillHandleShowingUpdate:(BOOL)handleShowingUpdate
                                         forUpdate:(SUAppcastItem *)update
                                             state:(SPUUserUpdateState *)state {
  if (handleShowingUpdate || state.userInitiated || scheduledUpdateCallback == nullptr) {
    return;
  }

  napi_handle_scope scope;
  if (napi_open_handle_scope(scheduledUpdateEnv, &scope) != napi_ok) return;

  napi_value callback;
  napi_value global;
  napi_value version;
  napi_status status = napi_get_reference_value(scheduledUpdateEnv, scheduledUpdateCallback, &callback);
  if (status == napi_ok) status = napi_get_global(scheduledUpdateEnv, &global);
  const char *versionString = update.displayVersionString.UTF8String;
  if (status == napi_ok) {
    status = napi_create_string_utf8(scheduledUpdateEnv, versionString, NAPI_AUTO_LENGTH, &version);
  }
  if (status == napi_ok) {
    status = napi_call_function(scheduledUpdateEnv, global, callback, 1, &version, nullptr);
  }
  if (status == napi_pending_exception) {
    napi_value exception;
    napi_get_and_clear_last_exception(scheduledUpdateEnv, &exception);
    NSLog(@"[sparkle] scheduled update callback failed");
  }
  napi_close_handle_scope(scheduledUpdateEnv, scope);
}

@end

static AMDMUpdaterDelegate *updaterDelegate;

static void createUpdaterController(void) {
  if (updaterDelegate == nil) {
    updaterDelegate = [[AMDMUpdaterDelegate alloc] init];
  }
  updaterController = [[SPUStandardUpdaterController alloc]
      initWithStartingUpdater:YES
               updaterDelegate:nil
              userDriverDelegate:updaterDelegate];
}

static napi_value getUndefined(napi_env env) {
  napi_value value;
  napi_get_undefined(env, &value);
  return value;
}

static napi_value startUpdater(napi_env env, napi_callback_info) {
  if (![NSThread isMainThread]) {
    napi_throw_error(env, "SPARKLE_THREAD_ERROR", "Sparkle must start on the main thread");
    return nullptr;
  }

  @autoreleasepool {
    if (updaterController == nil) {
      createUpdaterController();
    }
  }

  return getUndefined(env);
}

static napi_value startUpdaterWithCallback(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value args[1];
  napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
  if (argc == 1) {
    napi_valuetype type;
    if (napi_typeof(env, args[0], &type) == napi_ok && type == napi_function) {
      if (scheduledUpdateCallback != nullptr) {
        napi_delete_reference(env, scheduledUpdateCallback);
      }
      scheduledUpdateEnv = env;
      napi_create_reference(env, args[0], 1, &scheduledUpdateCallback);
    }
  }
  return startUpdater(env, info);
}

static napi_value checkForUpdates(napi_env env, napi_callback_info info) {
  startUpdater(env, info);
  if (updaterController != nil) {
    [updaterController checkForUpdates:nil];
  }
  return getUndefined(env);
}

static napi_value recheckForUpdates(napi_env env, napi_callback_info info) {
  if (![NSThread isMainThread]) {
    napi_throw_error(env, "SPARKLE_THREAD_ERROR", "Sparkle must restart on the main thread");
    return nullptr;
  }

  @autoreleasepool {
    // A gentle scheduled reminder keeps its discovered update session alive.
    // Discard it so this user action fetches the appcast again instead of
    // bringing the stale update alert into focus.
    updaterController = nil;
    createUpdaterController();
    [updaterController checkForUpdates:nil];
  }

  return getUndefined(env);
}

static napi_value getAutomaticallyChecksForUpdates(napi_env env, napi_callback_info info) {
  startUpdater(env, info);
  napi_value value;
  napi_get_boolean(env, updaterController.updater.automaticallyChecksForUpdates, &value);
  return value;
}

static napi_value setAutomaticallyChecksForUpdates(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value args[1];
  napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
  if (argc != 1) {
    napi_throw_type_error(env, nullptr, "Expected an enabled boolean");
    return nullptr;
  }
  bool enabled;
  if (napi_get_value_bool(env, args[0], &enabled) != napi_ok) {
    napi_throw_type_error(env, nullptr, "Expected an enabled boolean");
    return nullptr;
  }
  startUpdater(env, info);
  updaterController.updater.automaticallyChecksForUpdates = enabled;
  return getUndefined(env);
}

static napi_value initialize(napi_env env, napi_value exports) {
  napi_property_descriptor properties[] = {
      {"start", nullptr, startUpdaterWithCallback, nullptr, nullptr, nullptr, napi_default,
       nullptr},
      {"checkForUpdates", nullptr, checkForUpdates, nullptr, nullptr, nullptr, napi_default,
       nullptr},
      {"recheckForUpdates", nullptr, recheckForUpdates, nullptr, nullptr, nullptr, napi_default,
       nullptr},
      {"getAutomaticallyChecksForUpdates", nullptr, getAutomaticallyChecksForUpdates, nullptr,
       nullptr, nullptr, napi_default, nullptr},
      {"setAutomaticallyChecksForUpdates", nullptr, setAutomaticallyChecksForUpdates, nullptr,
       nullptr, nullptr, napi_default, nullptr},
  };

  if (napi_define_properties(env, exports, 5, properties) != napi_ok) {
    napi_throw_error(env, "SPARKLE_INIT_ERROR", "Unable to expose Sparkle API");
    return nullptr;
  }

  return exports;
}

NAPI_MODULE(NODE_GYP_MODULE_NAME, initialize)
