// services/geminiService.ts
import { blobToBase64 } from "./audioService";
import { GoogleGenAI } from "@google/genai";

// ============================================================================
// 1. 核心連線 (用於 OCR 與 整合)
// ============================================================================
const getAiClient = () => {
    // 透過 vite.config.ts 定義的環境變數取得 Key
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        throw new Error("API Key not found. Please check your .env.local file.");
    }
    return new GoogleGenAI({ apiKey });
};

const getModelId = () => {
    return process.env.GEMINI_MODEL || "gemini-2.0-flash"; 
};

// [核心功能] 呼叫後端 PHP 代理的通用函式
const callGeminiProxy = async (action: string, payload: any): Promise<string> => {
  try {
    // [修改] 使用您提供的正確完整網址，不再使用相對路徑
    const proxyUrl = 'https://www.churchintaichung.org/trans/proxy.php';
    
    const response = await fetch(proxyUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, payload }),
    });

    if (!response.ok) {
      const errText = await response.text();
      // 如果看到 404，代表網址還是錯的；如果看到 500，代表 PHP 程式執行錯誤
      throw new Error(`Server Error (${response.status}): ${errText}`);
    }

    const data = await response.json();

    if (data.candidates && data.candidates[0]?.content?.parts?.[0]?.text) {
      return data.candidates[0].content.parts[0].text;
    } else if (data.error) {
      throw new Error(`Google API Error: ${data.error.message || JSON.stringify(data.error)}`);
    } else {
      console.warn("未知的回傳結構:", data);
      return "";
    }

  } catch (error) {
    console.error(`Gemini Proxy Error [${action}]:`, error);
    throw error;
  }
};

// 1. 音訊聽抄
export const transcribeAudioChunk = async (
  audioBlob: Blob, 
  previousContext?: string
): Promise<string> => {
  const base64Data = await blobToBase64(audioBlob);
  
  // [中英雙語優化版 Prompt]
  const prompt = `
    You are a professional multilingual transcriber for Living Stream Ministry (LSM).
    Your task is to transcribe the audio exactly as spoken, with high accuracy in spiritual terminology.

    **Step 1: Language Detection**
    - Automatically detect if the primary language is English or Chinese.
    - If English: Output the transcript in **English**.
    - If Chinese: Output the transcript in **Traditional Chinese (繁體中文)**.
    - If the audio is bilingual (code-switching), preserve both languages as spoken.

    **Step 2: Speaker Identification**
    - Detect distinct voices. Label them as **[Speaker 1]**, **[Speaker 2]**, etc.
    - Start a new line whenever the speaker changes.

    **Step 3: Terminology Accuracy (Crucial)**
    - **Source Material**: Refer to the Recovery Version Bible, Life-studies, and the ministry of Watchman Nee and Witness Lee.
    - **For English Transcription**:
        - Use standard LSM terms: "Economy of God", "Dispensation", "Divine-human mingling", "Fellowship", "Functioning", "Blending", "Body of Christ".
        - Ensure biblical names follow the Recovery Version (e.g., "Timothy", "Ephesians").
    - **For Chinese Transcription (Traditional Chinese ONLY)**:
        - 必須使用職事專有名詞：使用「交通」而非「交流」；使用「盡功用」而非「發揮功能」；使用「相調」而非「混合」；使用「神聖經綸」而非「上帝的計劃」。
        - 聖經書卷與人名必須符合《恢復本聖經》（如：馬太福音、以弗所書）。

    **Step 4: Transcription Rules**
    - **Verbatim**: Transcribe exactly what is said. 
    - **Clean Verbatim**: Omit fillers like "uh", "um", "ah" unless they carry specific emotional weight.
    - **Punctuation**: Use appropriate punctuation to reflect the speaker's rhythm and intent.

    **Step 5: Continuity**
    ${previousContext ? `**Previous Context** (use for continuity, do not repeat): "...${previousContext.slice(-200)}"` : ''}

    **Output**: Return ONLY the transcribed text.
  `;

  return callGeminiProxy('transcribe', {
    audioBase64: base64Data,
    prompt: prompt
  });
};

// 2. 潤稿與合併
export const refineAndMergeTranscript = async (
    fullText: string, 
    userInstructions?: string  // [修改] 新增參數接收使用者的指令
): Promise<string> => {
    const prompt = `
      You are a senior editor for the Living Stream Ministry (LSM).
      You are refining a raw transcript merged from audio segments.

      **Input Text**:
      ${fullText}

      **User Instructions (HIGHEST PRIORITY)**:
      ${userInstructions 
        ? `The user has provided specific corrections. You MUST follow these strictly to fix names, locations, or terminology:\n"${userInstructions}"` 
        : "No specific user instructions provided."
      }

      **Your Mission**:
      Refine the text into a readable, accurate ministry transcript while preserving the original meaning and speaker flow.

      **Strict Editing Rules**:
      1. **Speaker Formatting**:
         - Ensure speaker labels (e.g., [Speaker 1], [Speaker 2]) are clearly separated by newlines.
         - If the same speaker continues across a chunk break, merge the text seamlessly.
      2. **Terminology Correction**:
         - **CRITICAL**: Standardize all terms according to the Recovery Version Bible and LSM publications.
         - Correct common homophone errors in ministry context (e.g., ensure "神" vs "人", "靈" vs "零").
         - **Apply User Instructions**: If the user specified a name (e.g., "Change 0 Brother to Brother Lin"), execute it here.
      3. **Punctuation & Flow**:
         - Fix broken sentences at connection points.
         - Convert spoken rhythm into proper written punctuation.
      4. **Fidelity**:
         - Do NOT summarize. Do NOT delete content. Keep the full message.
         - Remove ONLY pure stuttering or meaningless fillers.
      5. **Language**:
         - **MUST output in Traditional Chinese (繁體中文)**.

      **Output**:
      Return ONLY the refined transcript text.
    `;

    try {
        // 這裡不需要改動 key，因為參數是包在 prompt 字串裡的
        return await callGeminiProxy('refine', { prompt });
    } catch (e) {
        console.warn("Refining failed, returning original", e);
        return fullText;
    }
};

// 3. 翻譯
export const translateTranscript = async (text: string): Promise<string> => {
    const prompt = `
      You are a professional translator specializing in Watchman Nee and Witness Lee publications.

      Task: Translate the text. 
      - English -> Traditional Chinese (繁體中文).
      - Chinese -> English.

      CRITICAL RULES:
      1. **Authority**: Strictly adhere to terminology in the Recovery Version Bible, Life-studies, and Collected Works of Watchman Nee/Witness Lee (LSM/TWGBR).
      2. **Exclusion**: Do NOT use Union Version (和合本) or general Christian terms if they differ from the Recovery Version.
      3. **Fidelity**: Translate sentence by sentence. Do NOT summarize.
      4. **Language**: Use Traditional Chinese (繁體中文) for all Chinese characters.
      5. **Output**: Output ONLY the translation.

      Text to translate:
      ${text}
    `;

    return callGeminiProxy('translate', { prompt });
};

// 4. 排版 (LSM Style)
export const formatToLSMStyle = async (text: string): Promise<string> => {
    const prompt = `
      You are an editor for Living Stream Ministry (LSM). 
      Format the following text into a "Conference Outline" style using HTML.

      Rules:
      1. Analyze the text logic and structure it hierarchically using the standard LSM outline format:
         - Level 1: Roman Numerals (I., II.) - <b>Bold</b>
         - Level 2: Capital Letters (A., B.)
         - Level 3: Arabic Numerals (1., 2.)
         - Level 4: Lowercase Letters (a., b.)
      2. If the text is continuous speech, break it down logically into these points.
      3. Return ONLY the HTML string. Use <div> or <p> tags with inline styles for indentation.
         - Level 1: margin-left: 0px; font-weight: bold; font-family: 'Times New Roman', 'PMingLiU', serif;
         - Level 2: margin-left: 20px; font-family: 'Times New Roman', 'PMingLiU', serif;
         - Level 3: margin-left: 40px; font-family: 'Times New Roman', 'PMingLiU', serif;
         - Level 4: margin-left: 60px; font-family: 'Times New Roman', 'PMingLiU', serif;
      4. Use a Serif font stack ('Times New Roman', 'PMingLiU', serif) for all text.
      5. Do NOT change the core content words, just structure them.
      6. **Language Requirement: Ensure all Chinese text is output in Traditional Chinese (繁體中文).**

      Text to format:
      ${text}
    `;

    try {
        return await callGeminiProxy('format', { prompt });
    } catch (e) {
        console.error("Formatting Error:", e);
        return text;
    }
};

// 5. 連結增強
export const enrichWithLinks = async (text: string): Promise<string> => {
    const prompt = `
      You are a research assistant for the Recovery Version Bible and Ministry Books.
      Analyze the text and add HTML hyperlinks <a> tags to specific references.

      Linking Rules:
      1. **Bible Verses (Chinese)**: 
         - Detect Chinese Bible verses (e.g., "馬太福音一章23節", "創世記1:1").
         - **Logic**: You must identify the Book Name, Chapter, and Verse number.
         - **Conversion**: Convert the Book Name into its standard index number (Genesis=1, Malachi=39, Matthew=40, Revelation=66).
         - **Format**: Construct the URL as: \`https://recoveryversion.com.tw/Style0A/026/read_List.php?f_BookNo=[BookIndex]&f_ChapterNo=[Chapter]&f_VerseNo=[Verse]#[Verse]\`
         - **Example**: "馬太福音一章23節" becomes \`...read_List.php?f_BookNo=40&f_ChapterNo=1&f_VerseNo=23#23\`

      2. **Bible Verses (English)**:
         - Detect verses (e.g., "John 3:16").
         - Link to \`https://online.recoveryversion.bible/Search/Search.asp?q=[VerseReference]\`
      
      3. **Ministry Terms/Books**:
         - Detect mentions of specific books (e.g., "Life-study of Genesis", "The Vital Groups").
         - Also detect specific theological terms if they appear in book titles.
         - If Chinese: Link to \`https://www.twgbr.org.tw/products?query=[Term]\`
         - If English: Link to \`https://www.ministrybooks.org/books/?t=ALL&f=[Term]\`

      4. **Original Language**:
         - If Greek or Hebrew words are mentioned, link them to a general search on the respective sites.

      5. **Output**: Return the text fully formatted in HTML. Add <a> tags with target="_blank" and style="color: #2563eb; text-decoration: underline;".
      6. **Language Requirement**: Ensure all Chinese text remains in Traditional Chinese (繁體中文).

      Text to enrich:
      ${text}
    `;

    try {
        return await callGeminiProxy('enrich', { prompt });
    } catch (e) {
        console.error("Linking Error:", e);
        return text;
    }
};

// services/geminiService.ts

export const summarizeMeeting = async (text: string): Promise<string> => {
    const prompt = `
      You are a senior secretary for the Lord's Recovery. 
      Task: Create formal "Meeting Minutes" from the provided transcript, strictly following the chronological order.

      **CRITICAL RULES (Anti-Hallucination)**:
      1. **NO Fabrication**: You must base the summary **ONLY** on the provided text. Do NOT invent details, dates, or decisions that are not explicitly stated.
      2. **Handle Missing Info**: If a discussion ends without a clear decision, state "本案尚未有明確決議" (No clear decision reached yet). Do NOT guess the outcome.
      3. **No External Knowledge**: Do not add information from outside this transcript (e.g., don't assume standard church schedules unless mentioned).

      **Structure Logic**:
      Organize the content by "Agenda Item" chronologically. Each major item (Roman Numeral) must include:

      I. [議案名稱/主題]
         A. **議案背景與內容 (Proposal)**: Briefly describe what was brought up.
         B. **交通之不同看法或意見 (Fellowship & Discussion)**: 
            - Summarize the dialogue and different perspectives.
            - **MUST** reflect the actual flow of fellowship (e.g., if there were concerns, list them).
            - Use format: "[Speaker X]: Key view".
         C. **決議與共識 (Decision & Consensus)**: 
            - Clearly state the final conclusion. 
            - If no conclusion, state "需後續再交通" (Need further fellowship).
         D. **具體服事安排與負擔 (Action Items & Burden)**: 
            - 具體動作 (What)
            - 服事者 (Who) - *Only if mentioned*
            - 時間表 (When) - *Only if mentioned*
            - 靈中負擔 (Spiritual Burden)

      **Formatting Rules**:
      1. **Chronological Order**: Process from start to finish.
      2. Use LSM standard hierarchical numbering: I., A., 1., a.
      3. Return ONLY HTML string with:
         - Level 1: <b>Bold</b>, margin-left: 0px.
         - Level 2: margin-left: 20px; color: #1e40af; (Dark blue)
         - Level 3: margin-left: 40px;
      4. **Language**: Traditional Chinese (繁體中文).
      5. **Terminology**: Strictly use LSM standard terms (e.g., 交通, 經綸, 相調).

      Transcript to process:
      ${text}
    `;

    try {
        return await callGeminiProxy('format', { prompt });
    } catch (e) {
        console.error("Summarization Error:", e);
        throw e;
    }
};

export const processDocument = async (
  fileBlob: Blob,
  mimeType: string
): Promise<string> => {
  const ai = getAiClient();
  const base64Data = await blobToBase64(fileBlob);
  const modelId = getModelId(); 

  const prompt = `
    你是一位專業的職事文書處理專家。
    請精確地辨識並提取此文件（PDF或圖片）中的所有文字內容。

    **處理原則**：
    1. **完整提取**：請從第一頁到最後一頁完整提取文字，不要遺漏，也不要進行總結。
    2. **結構保留**：盡量保留原有的標題、段落結構與列表格式。
    3. **術語校對**：若遇到模糊字跡，請自動根據主恢復職事常用術語進行校對（例如：交通、經綸、相調、靈中負擔）。
    4. **語言**：請輸出為繁體中文。

    輸出格式：直接回傳提取後的純文字內容。
  `;

  try {
    const response = await ai.models.generateContent({
      model: modelId,
      contents: {
        parts: [
          {
            inlineData: {
              mimeType: mimeType,
              data: base64Data,
            },
          },
          { text: prompt },
        ],
      },
    });

    return response.text || "";
  } catch (error) {
    console.error("Document OCR Error:", error);
    throw error;
  }
};

export const integrateTranscriptByOutline = async (outline: string, transcript: string): Promise<string> => {
    const ai = getAiClient();
    const modelId = getModelId();

    const prompt = `
      You are a senior editorial expert for LSM publications.
      
      **Task**:
      I will provide you with a "Reference Outline" (standard LSM format) and a "Full Transcript".
      Your goal is to smartly distribute the transcript content into the appropriate sections of the outline.

      **Inputs**:
      1. **Reference Outline**: 
      ${outline}
      
      2. **Full Transcript**: 
      ${transcript}

      **Strict Execution Rules**:
      1. **Structure Preservation**: You MUST keep the original Outline structure (I., A., 1...) exactly as it is.
      2. **Contextual Mapping**: Analyze which part of the transcript belongs to which Outline point.
      3. **NO DELETION OR SUMMARIZATION**: You MUST retain the ENTIRE transcript. Every single sentence from the transcript must be placed under an outline point. Do not drop, omit, or summarize any paragraphs, even if they seem loosely connected.
      4. **Basic Editing Only**: You are allowed to perform minor proofreading (e.g., removing redundant filler words, correcting obvious speech disfluencies or typos) to make it readable, but you CANNOT change the core meaning or reduce the overall length of the speaker's content.
      5. **Smart Interleaving**: Append the relevant transcript text directly under its corresponding outline point. 
      6. **Formatting**: Return the result in HTML string:
         - **Outline Points**: Use <b style="color: #000000;">Bold Black</b> with proper indentation (margin-left).
         - **Scriptures**: If there are Bible verses citations (e.g., Genesis 1:1, 馬太福音一章1節) in the outline or text, wrap them in <span style="color: #8B0000; font-weight: bold;"> (Dark Red).
         - **Transcript Text**: Normal weight, wrapped in <div style="color: #003366; margin-bottom: 15px; margin-left: 20px; font-size: 0.95em;"> (Dark Blue).
      7. **Language**: Traditional Chinese (繁體中文).

      Output ONLY the combined HTML.
    `;

    try {
        const response = await ai.models.generateContent({
            model: modelId,
            contents: prompt
        });
        return response.text || "";
    } catch (e) {
        console.error("Integration Error:", e);
        throw e;
    }
};