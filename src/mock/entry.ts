/**
 * The package's module: the API (`index.ts`, which its type declarations are made from) and the
 * fonts. Kept apart so the declarations carry no import of a stylesheet a consumer can't resolve.
 */
import './fonts.css';

export * from './index';
