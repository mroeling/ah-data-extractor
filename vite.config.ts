import aurelia from '@aurelia/vite-plugin';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [
    aurelia({
      include: 'src/**/*.html'
    })
  ],
  build: {
    target: 'esnext'
  },
  server: {
    port: 5173
  }
});
