module.exports = {
  preset: 'jest-expo',
  testPathIgnorePatterns: ['/node_modules/', '/.expo/'],
  // watchman binary on this machine is broken (dyld: missing libfmt) — Jest's built-in
  // file crawler works fine without it, and this keeps `npm test` host-independent.
  watchman: false,
  // src/lib/supabase.ts imports AsyncStorage at module scope; anything that transitively
  // imports it (e.g. availabilityApi.ts) needs the native module mocked to be importable
  // under Jest at all, per @react-native-async-storage/async-storage's own Jest docs.
  moduleNameMapper: {
    '^@react-native-async-storage/async-storage$':
      '@react-native-async-storage/async-storage/jest/async-storage-mock',
  },
};
