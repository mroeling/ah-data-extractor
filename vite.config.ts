import aurelia from "@aurelia/vite-plugin";
import { defineConfig } from "vite";

export default defineConfig({
  base: "",
  plugins: [
    aurelia({
      include: "src/**/*.html",
    }),
  ],
  build: {
    target: "esnext",
    sourcemap: true,
  },
  server: {
    port: 5173,
  },
});
