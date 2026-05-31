// app/entry.jsx — единственная точка входа для esbuild-сборки.
// Файлы ниже не экспортируют ничего — все «модули» договариваются
// через присваивание на window.* (window.Data, window.Router, …).
// Порядок имеет значение: data → router/ui → экраны → main.
import './data.jsx';
import './router.jsx';
import './ui.jsx';
import './home.jsx';
import './changes.jsx';
import './editor.jsx';
import './settings.jsx';
import './main.jsx';
