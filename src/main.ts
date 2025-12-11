// src/main.ts
import Aurelia from 'aurelia';
import { DataExtractorView } from './components/data-extractor-view';
import './styles.css';

// Simpele startup volgens de Aurelia 2 docs:
// Aurelia.app(MyRootComponent).start();
Aurelia
  .app(DataExtractorView)
  .start();
