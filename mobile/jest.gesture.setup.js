/**
 * Runs before react-native-gesture-handler's own jestSetup so that the mock
 * registration wins over the real module (which jestSetup eagerly requires).
 *
 * Gesture Handler 3 throws in DEV when a GestureDetector renders without a
 * GestureHandlerRootView ancestor; unit tests mount components in isolation.
 */
jest.mock('react-native-gesture-handler/src/v3/detectors/useEnsureGestureHandlerRootView', () => ({
  useEnsureGestureHandlerRootView: () => undefined,
}));

jest.mock('react-native-gesture-handler/lib/module/v3/detectors/useEnsureGestureHandlerRootView', () => ({
  useEnsureGestureHandlerRootView: () => undefined,
}));

// Worklets runs in its "web" flavour under Jest, where getUIRuntimeHolder
// throws. Gesture Handler only needs the binding on device.
jest.mock('react-native-gesture-handler/src/handlers/gestures/installUIRuntimeBindings', () => ({
  installUIRuntimeBindings: () => undefined,
}));

jest.mock('react-native-gesture-handler/lib/module/handlers/gestures/installUIRuntimeBindings', () => ({
  installUIRuntimeBindings: () => undefined,
}));
