const functions = require("firebase-functions");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const logger = functions.logger;

// Helper function to introduce a delay
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Helper function for API calls with retry logic
async function generateContentWithRetry(model, prompt, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const result = await model.generateContent(prompt);
      return result; // Success
    } catch (error) {
      logger.error(`Attempt ${attempt} failed:`, error);
      // Check if the error is a 503 or a similar transient error
      if (error.message && error.message.includes("503")) {
        if (attempt < maxRetries) {
          logger.info(`Retrying in 2 seconds...`);
          await delay(2000); // Wait for 2 seconds before retrying
        } else {
          logger.error("Max retries reached. Failing.");
          throw new functions.https.HttpsError('unavailable', 'AI 모델의 일시적인 과부하가 발생했습니다. 잠시 후 다시 시도해주세요.');
        }
      } else {
        // Not a retryable error, throw it immediately
        throw error;
      }
    }
  }
}


/**
 * 학습 주제를 받아 AI 기반 학습 로드맵을 생성하는 함수
 */
exports.generateRoadmap = functions.https.onCall(async (data, context) => {
  try {
    const topic = data.data.topic; 

    if (!topic) {
      logger.error("Topic is missing in the request data:", data);
      throw new functions.https.HttpsError('invalid-argument', '주제가 필요합니다.');
    }

    const API_KEY = process.env.GEMINI_KEY;
    if (!API_KEY) {
      logger.error("Gemini API key not configured.");
      throw new functions.https.HttpsError('internal', 'Gemini API 키가 설정되지 않았습니다.');
    }

    const genAI = new GoogleGenerativeAI(API_KEY);
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

    const prompt = `
      당신은 IT 및 다양한 학문 분야의 학습 로드맵을 전문적으로 설계하는 AI입니다.
      사용자가 입력한 학습 주제인 "${topic}"에 대한 체계적인 학습 로드맵을 JSON 형식으로 생성해주세요.

      JSON 구조는 다음과 같아야 합니다:
      {
        "title": "${topic} 학습 로드맵",
        "nodes": [
          { "id": "center", "label": "${topic}", "isCentral": true },
          { "id": "node1", "label": "핵심 개념 1", "parent": "center" },
          { "id": "node2", "label": "핵심 개념 2", "parent": "center" },
          { "id": "node1-1", "label": "세부 개념 1-1", "parent": "node1" },
          ...
        ]
      }

      - "nodes" 배열에는 학습 단계를 나타내는 객체들이 포함됩니다.
      - 최상위 노드는 "center" id를 가지며, 사용자가 입력한 주제가 됩니다.
      - 각 노드는 고유한 "id", 화면에 표시될 "label", 그리고 부모 노드를 가리키는 "parent"를 가집니다.
      - 학습의 논리적 흐름과 중요도에 따라 단계를 나누고, 초급자도 이해하기 쉽도록 명확하고 간결한 레이블을 사용해주세요.
      - 최소 5개에서 최대 10개의 노드를 생성하여 너무 복잡하지 않게 만들어주세요.
    `;

    try {
      const result = await generateContentWithRetry(model, prompt); // Use retry helper
      const response = await result.response;
      const text = response.text();
      
      const jsonString = text.trim().startsWith('```json') 
          ? text.trim().slice(7, -3).trim() 
          : text.trim();
      const roadmapData = JSON.parse(jsonString);

      logger.info("Roadmap generated successfully for:", topic);
      return roadmapData;

    } catch (error) {
      logger.error("Error generating roadmap:", error);
      if (error instanceof functions.https.HttpsError) {
        throw error;
      }
      throw new functions.https.HttpsError('internal', '로드맵 생성에 실패했습니다.');
    }
  } catch (outerError) {
    logger.error("Unhandled error in generateRoadmap:", outerError);
    if (outerError instanceof functions.https.HttpsError) {
        throw outerError;
    }
    throw new functions.https.HttpsError('internal', `로드맵 생성 중 예상치 못한 오류 발생: ${outerError.message}`);
  }
});


exports.getLearningResources = functions.https.onCall(async (data, context) => {
  try {
    const nodeLabel = data.data.nodeLabel;
    if (!nodeLabel) {
        logger.error("nodeLabel is missing in the request data:", data);
        throw new functions.https.HttpsError('invalid-argument', '노드 레이블이 필요합니다.');
    }

    const API_KEY = process.env.GEMINI_KEY;
    if (!API_KEY) {
        logger.error("Gemini API key not configured.");
        throw new functions.https.HttpsError('internal', 'Gemini API 키가 설정되지 않았습니다.');
    }
    const genAI = new GoogleGenerativeAI(API_KEY);
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

    const prompt = `
      당신은 사용자가 요청한 주제에 대해 가장 관련성 높고 유용한 학습 자료를 찾아주는 전문가입니다.
      주제: "${nodeLabel}"

      **엄격한 지침:**
      1.  **실존하는 URL만 생성:** 반드시 실제 존재하고, 공개적으로 접근 가능하며, 유효한 URL만 제공해야 합니다. 절대로 가상의 URL을 만들지 마세요.
      2.  **높은 관련성:** 추천하는 모든 자료(영상, 아티클)는 요청된 주제 "${nodeLabel}"와 직접적이고 명확하게 관련이 있어야 합니다.
      3.  **품질 보증:** 초보자가 이해하기 쉽고, 내용이 충실하며, 신뢰할 수 있는 출처의 자료를 우선적으로 추천합니다.
      4.  **금지 사항:** 장난(예: rickroll), 광고, 관련 없는 웹페이지, 현재 웹사이트 주소 등은 절대 포함하지 마세요.

      **요청사항:**
      위 지침을 반드시 준수하여, 주제와 관련된 유튜브 영상 2개와 고품질 아티클 2개를 찾아 아래 JSON 형식으로 반환해주세요.

      {
        "resources": [
          { "type": "video", "title": "영상 제목", "url": "실제_유튜브_URL" },
          { "type": "video", "title": "다른 영상 제목", "url": "다른_실제_유튜브_URL" },
          { "type": "article", "title": "아티클 제목", "url": "실제_아티클_URL" },
          { "type": "article", "title": "다른 아티클 제목", "url": "다른_실제_아티클_URL" }
        ]
      }
    `;

    try {
        const result = await generateContentWithRetry(model, prompt); // Use retry helper
        const response = await result.response;
        const text = response.text();
        
        const jsonMatch = text.match(/```json\n([\s\S]*?)\n```/);
        let jsonString;
        if (jsonMatch && jsonMatch[1]) {
            jsonString = jsonMatch[1].trim();
        } else {
            const firstBrace = text.indexOf('{');
            const lastBrace = text.lastIndexOf('}');
            if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
                jsonString = text.substring(firstBrace, lastBrace + 1).trim();
            } else {
                throw new Error("Could not extract JSON from Gemini response.");
            }
        }
        const resourceData = JSON.parse(jsonString);

        logger.info("Resources found successfully for:", nodeLabel);
        return resourceData;

    } catch (error) {
        logger.error("Error fetching resources:", error);
        if (error instanceof functions.https.HttpsError) {
          throw error;
        }
        throw new functions.https.HttpsError('internal', '학습 자료를 불러오는 데 실패했습니다.');
    }
  } catch (outerError) {
    logger.error("Unhandled error in getLearningResources:", outerError);
    if (outerError instanceof functions.https.HttpsError) {
        throw outerError;
    }
    throw new functions.https.HttpsError('internal', `학습 자료 로드 중 예상치 못한 오류 발생: ${outerError.message}`);
  }
});