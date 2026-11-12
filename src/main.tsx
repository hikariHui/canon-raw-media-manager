import React from "react";
import ReactDOM from "react-dom/client";
import "animal-island-ui/style";
import App from "./App";
import { AppProvider } from "./context/AppContext";
import { ModeProvider } from "./context/ModeContext";
import { PhotoProvider } from "./photo/PhotoContext";

ReactDOM.createRoot(document.getElementById("app")!).render(
  <React.StrictMode>
    <ModeProvider>
      <AppProvider>
        <PhotoProvider>
          <App />
        </PhotoProvider>
      </AppProvider>
    </ModeProvider>
  </React.StrictMode>,
);
