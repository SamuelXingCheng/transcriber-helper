import React from 'react';
import { Transcriber } from './components/Transcriber';

const App: React.FC = () => {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-gray-100">
      <nav className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16">
            <div className="flex items-center gap-2">
              {/* 修改 1: LSM 圖示縮小，手機 text-sm，電腦恢復 text-lg */}
              <span className="bg-blue-600 text-white p-1 rounded font-bold text-sm md:text-lg">LSM</span>
              
              {/* 修改 2: 標題文字縮小，手機 text-sm 或 text-base，電腦恢復 text-xl */}
              <span className="font-semibold text-sm md:text-xl tracking-tight text-gray-800">
                主恢復聽抄翻譯<span className="text-blue-600">小幫手</span>
              </span>
            </div>
            
            <div className="flex items-center">
              {/* 修改 3 (選配): Powered by 文字在手機上也可以縮小一點 */}
              <span className="text-[10px] md:text-xs font-medium text-gray-400 bg-gray-100 px-2 py-1 rounded">
                Powered by Gemini AI
              </span>
            </div>
          </div>
        </div>
      </nav>

      <main className="py-6 md:py-10"> {/* 修改 4: 手機版上下的 padding 也稍微縮小 (py-6) */}
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