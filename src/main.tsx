import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App";
import { StreamCard } from "./components/StreamCard";

const card = new URLSearchParams(location.search).has("card");

createRoot(document.getElementById("root")!).render(<StrictMode>{card ? <StreamCard /> : <App />}</StrictMode>);
