const defaultTheme = require("tailwindcss/defaultTheme");
const formsPlugin = require("@tailwindcss/forms");

module.exports = {
  content: ["index.html", "src/**/*.tsx"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Inter var", ...defaultTheme.fontFamily.sans],
      },
    },
  },
  plugins: [formsPlugin],
};
