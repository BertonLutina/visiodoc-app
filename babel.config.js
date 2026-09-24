module.exports = function (api) {
  api.cache(true);
  return {
    presets: [
      ['babel-preset-expo', { jsxImportSource: 'nativewind' }],
      'nativewind/babel',
    ],
    // Reanimated 4 : le plugin Babel est désormais fourni par react-native-worklets et doit rester en dernier.
    plugins: ['react-native-worklets/plugin'],
  };
};
