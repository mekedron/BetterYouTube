import { mount } from 'svelte';
import App from './App.svelte';
import './app.css';

document.documentElement.lang = browser.i18n.getUILanguage();

const app = mount(App, {
  target: document.getElementById('app')!,
});

export default app;
