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

export const transcribeAudioChunk = async (
  audioBlob: Blob, 
  previousContext?: string
): Promise<string> => {
  const ai = getAiClient();
  const base64Data = await blobToBase64(audioBlob);

  const modelId = "gemini-3-flash-preview"; 

  const prompt = `
    You are a professional transcriber. 
    Transcribe the following audio exactly as spoken. 
    The audio may contain English or Chinese. 
    
    ${previousContext ? `Context from the previous segment: "...${previousContext.slice(-200)}". Continue seamlessly.` : ''}

    Rules:
    1. Output ONLY the transcription. No preamble, no "Here is the transcript".
    2. If there are multiple speakers, indicate them with "Speaker 1:", "Speaker 2:" only if distinct.
    3. Ignore filler words like "um", "uh" unless they add meaning.
    4. Ensure correct punctuation.
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
    const modelId = "gemini-3-pro-preview";

    const prompt = `
      You are a strict verbatim editor. The following text is a merged transcript from audio chunks.
      
      Your task:
      1. Fix broken sentences at the connection points.
      2. Remove ONLY meaningless filler words.
      3. Correct punctuation and organize into logical paragraphs.
      4. Correct obvious homophone errors.
      5. CRITICAL: Do NOT summarize. Do NOT change the wording or meaning. Keep every sentence originally spoken.
      6. Output only the refined transcript.

      Text to refine:
      ${fullText}
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
    const modelId = "gemini-3-pro-preview";

    const prompt = `
      You are a professional translator specializing in Watchman Nee and Witness Lee publications.

      Task: Translate the text. 
      - English -> Traditional Chinese (繁體中文).
      - Chinese -> English.

      CRITICAL RULES:
      1. **Authority**: Strictly adhere to terminology in the Recovery Version Bible, Life-studies, and Collected Works of Watchman Nee/Witness Lee (LSM/TWGBR).
      2. **Exclusion**: Do NOT use Union Version (和合本) or general Christian terms if they differ from the Recovery Version.
      3. **Fidelity**: Translate sentence by sentence. Do NOT summarize.
      4. **Output**: Output ONLY the translation.

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
    const modelId = "gemini-3-pro-preview";

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
    const modelId = "gemini-3-pro-preview";

    const prompt = `
      You are a research assistant for the Recovery Version Bible and Ministry Books.
      Analyze the text and add HTML hyperlinks <a> tags to specific references.

      Linking Rules:
      1. **Bible Verses**: 
         - Detect verses (e.g., "John 3:16", "Matthew 1:1", "創世記一章一節").
         - If Chinese: Link to \`https://www.recoveryversion.com.tw/Style0A/026/search_f.php?q=[VerseReference]\`
         - If English: Link to \`https://online.recoveryversion.bible/Search/Search.asp?q=[VerseReference]\`
      
      2. **Ministry Terms/Books**:
         - Detect mentions of specific books (e.g., "Life-study of Genesis", "生命讀經", "Further Talks on the Church Life").
         - Also detect specific theological terms: "God's Economy" (神的經綸), "The Spirit" (那靈).
         - If Chinese: Link to \`https://www.twgbr.org.tw/search?q=[Term]\`
         - If English: Link to \`https://www.ministrybooks.org/search.php?q=[Term]\`

      3. **Original Language**:
         - If Greek or Hebrew words are mentioned, link them to a general search on the respective sites.

      4. Return the text fully formatted in HTML, preserving the original structure but adding <a> tags with target="_blank" and style="color: #2563eb; text-decoration: underline;".

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