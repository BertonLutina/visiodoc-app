module.exports = {
  preset: 'jest-expo',
  testPathIgnorePatterns: ['/node_modules/', '/.expo/'],
  // watchman binary on this machine is broken (dyld: missing libfmt) — Jest's built-in
  // file crawler works fine without it, and this keeps `npm test` host-independent.
  watchman: false,
};
