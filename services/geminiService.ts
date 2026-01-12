// services/geminiService.ts
import { GoogleGenAI } from "@google/genai";
import { blobToBase64 } from "./audioService";

// Initialize Gemini
const getAiClient = () => {
    const apiKey = process.env.API_KEY;
    if (!apiKey) {
        throw new Error("API Key not found in environment variables.");
    }
    return new GoogleGenAI({ apiKey });
};

// Helper function to get model ID
const getModelId = () => {
    return process.env.GEMINI_MODEL || "gemini-3-flash-preview";
};

export const transcribeAudioChunk = async (
  audioBlob: Blob, 
  previousContext?: string
): Promise<string> => {
  const ai = getAiClient();
  const base64Data = await blobToBase64(audioBlob);
  const modelId = getModelId(); 

  // 優化後的聽抄 Prompt
  const prompt = `
    You are a professional transcriber for Living Stream Ministry (LSM).
    Your task is to transcribe the audio exactly as spoken, distinguishing between speakers.

    **Context**:
    - This audio contains ministry messages or fellowship related to the Lord's Recovery.
    - Specific Terminology Source: Recovery Version Bible (恢復本聖經), Life-studies (生命讀經), and the ministry of Watchman Nee and Witness Lee.

    **Instructions**:
    1. **Speaker Identification**: 
       - Detect distinct voices. Label them as **[Speaker 1]**, **[Speaker 2]**, etc.
       - Start a new line whenever the speaker changes.
    2. **Language**: 
       - Output MUST be in **Traditional Chinese (繁體中文)** if the audio is Chinese.
       - Do NOT use Simplified Chinese.
    3. **Terminology Accuracy**:
       - Use specific ministry terms (e.g., use "交通" instead of "交流", "盡功用" instead of "發揮功能", "相調" instead of "混合").
       - Listen carefully for biblical names and terms according to the Recovery Version.
    4. **Verbatim Transcription**:
       - Transcribe exactly what is said. 
       - Ignore meaningless filler words (like "um", "uh") unless they add emphasis.
       - Keep the original sentence structure.

    ${previousContext ? `**Previous Context** (for continuity only, do not repeat): "...${previousContext.slice(-200)}"` : ''}
  `;

  try {
    const response = await ai.models.generateContent({
      model: modelId,
      contents: {
        parts: [
          {
            inlineData: {
              mimeType: "audio/wav",
              data: base64Data,
            },
          },
          {
            text: prompt,
          },
        ],
      },
    });

    return response.text || "";
  } catch (error) {
    console.error("Gemini Transcription Error:", error);
    throw error;
  }
};

export const refineAndMergeTranscript = async (fullText: string): Promise<string> => {
    const ai = getAiClient();
    const modelId = getModelId();

    // 優化後的潤飾 Prompt
    const prompt = `
      You are a senior editor for the Living Stream Ministry (LSM).
      You are refining a raw transcript merged from audio segments.

      **Input Text**:
      ${fullText}

      **Your Mission**:
      Refine the text into a readable, accurate ministry transcript while preserving the original meaning and speaker flow.

      **Strict Editing Rules**:
      1. **Speaker Formatting**:
         - Ensure speaker labels (e.g., [Speaker 1], [Speaker 2]) are clearly separated by newlines.
         - If the same speaker continues across a chunk break, merge the text seamlessly.
      2. **Terminology Correction**:
         - **CRITICAL**: Standardize all terms according to the Recovery Version Bible and LSM publications.
         - Correct common homophone errors in ministry context (e.g., ensure "神" vs "人", "靈" vs "零").
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
        const response = await ai.models.generateContent({
            model: modelId,
            contents: prompt
        });
        return response.text || fullText;
    } catch (e) {
        console.warn("Refining failed, returning original", e);
        return fullText;
    }
};

export const translateTranscript = async (text: string): Promise<string> => {
    const ai = getAiClient();
    const modelId = getModelId();

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

    try {
        const response = await ai.models.generateContent({
            model: modelId,
            contents: prompt
        });
        return response.text || "";
    } catch (e) {
        console.error("Translation Error:", e);
        throw e;
    }
};

export const formatToLSMStyle = async (text: string): Promise<string> => {
    const ai = getAiClient();
    const modelId = getModelId();

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
        const response = await ai.models.generateContent({
            model: modelId,
            contents: prompt
        });
        return response.text || text;
    } catch (e) {
        console.error("Formatting Error:", e);
        throw e;
    }
};

export const enrichWithLinks = async (text: string): Promise<string> => {
    const ai = getAiClient();
    const modelId = getModelId();

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
        const response = await ai.models.generateContent({
            model: modelId,
            contents: prompt
        });
        return response.text || text;
    } catch (e) {
        console.error("Linking Error:", e);
        throw e;
    }
};