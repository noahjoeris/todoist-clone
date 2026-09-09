module.exports = (api) => {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    // Required by PowerSync for async-iterator watched queries on React Native.
    plugins: ['@babel/plugin-transform-async-generator-functions'],
  };
};
