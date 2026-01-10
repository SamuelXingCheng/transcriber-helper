import React from 'react';
import { Transcriber } from './components/Transcriber';

const App: React.FC = () => {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-gray-100">
      <nav className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16">
            <div className="flex items-center gap-2">
              <span className="bg-blue-600 text-white p-1 rounded font-bold text-lg">LSM</span>
              <span className="font-semibold text-xl tracking-tight text-gray-800">主恢復聽抄翻譯<span className="text-blue-600">小幫手</span></span>
            </div>
            <div className="flex items-center">
              <span className="text-xs font-medium text-gray-400 bg-gray-100 px-2 py-1 rounded">
                Powered by Gemini 3.0
              </span>
            </div>
          </div>
        </div>
      </nav>

      <main className="py-10">
        <Transcriber />
      </main>

      <footer className="bg-white border-t border-gray-200 mt-auto py-8">
        <div className="max-w-7xl mx-auto px-4 text-center text-gray-400 text-sm">
          <p>© {new Date().getFullYear()} 主恢復聽抄翻譯小幫手. 資料僅在瀏覽器與 Google Cloud 安全處理。</p>
        </div>
      </footer>
    </div>
  );
};

export default App;