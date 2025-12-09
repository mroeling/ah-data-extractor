// src/main.ts
import Aurelia from 'aurelia';
import { NestHeatmapView } from './components/nest-heatmap-view';

// Simpele startup volgens de Aurelia 2 docs:
// Aurelia.app(MyRootComponent).start();
Aurelia
  .app(NestHeatmapView)
  .start();
