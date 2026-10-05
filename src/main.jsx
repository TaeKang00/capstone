import React from "react";
import { createRoot } from "react-dom/client";
import "pretendard/dist/web/variable/pretendardvariable.css";
import "./styles.css";
import App from "./App.jsx";
import "./components/Select.css";
createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
