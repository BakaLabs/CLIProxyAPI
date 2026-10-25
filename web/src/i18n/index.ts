import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import en from "./locales/en";
import zhCN from "./locales/zh-CN";

export const namespaces = ["app", "nav", "login", "dashboard", "requestLogs", "logs", "providers", "authFiles", "oauth", "quota", "config", "plugins", "system", "common"] as const;

void i18next.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    "zh-CN": { translation: zhCN },
  },
  lng: localStorage.getItem("cpa-locale") || (navigator.language.toLowerCase().startsWith("zh") ? "zh-CN" : "en"),
  fallbackLng: "en",
  interpolation: { escapeValue: false },
  returnObjects: true,
});

export default i18next;
