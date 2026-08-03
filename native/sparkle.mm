#include <node_api.h>

#import <Cocoa/Cocoa.h>
#import <Sparkle/Sparkle.h>

static SPUStandardUpdaterController *updaterController;

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
      updaterController = [[SPUStandardUpdaterController alloc]
          initWithStartingUpdater:YES
                   updaterDelegate:nil
                  userDriverDelegate:nil];
    }
  }

  return getUndefined(env);
}

static napi_value checkForUpdates(napi_env env, napi_callback_info info) {
  startUpdater(env, info);
  if (updaterController != nil) {
    [updaterController checkForUpdates:nil];
  }
  return getUndefined(env);
}

static napi_value initialize(napi_env env, napi_value exports) {
  napi_property_descriptor properties[] = {
      {"start", nullptr, startUpdater, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"checkForUpdates", nullptr, checkForUpdates, nullptr, nullptr, nullptr, napi_default,
       nullptr},
  };

  if (napi_define_properties(env, exports, 2, properties) != napi_ok) {
    napi_throw_error(env, "SPARKLE_INIT_ERROR", "Unable to expose Sparkle API");
    return nullptr;
  }

  return exports;
}

NAPI_MODULE(NODE_GYP_MODULE_NAME, initialize)
