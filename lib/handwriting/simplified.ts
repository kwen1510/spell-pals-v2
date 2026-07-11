// Common traditional-only forms. Characters shared by both writing systems remain valid.
// This intentionally filters candidates rather than converting them: recognition output
// must describe what the student actually wrote.
const TRADITIONAL_ONLY = new Set(Array.from(
  "聽寫師飛場國學校車門馬魚鳥龍龜雲電風雨時間後裡這那們來去見說話謝請問對錯號處體頭驗認識讀書畫點線開關長短高興愛歡樂家寶貝錢買賣吃飯喝水氣燈紅綠藍白黑廣東灣臺灣萬億個幾隻條張顆邊過進遠近從到給會能應該為什麼樣樣真實畢業醫藥院廠站橋樓路樹葉花開關閉舊新親爺奶媽孫兄姊弟妹兒童條與無有實現發展產業經濟歷史文化科學技術網絡資訊軟體硬體設計創造運動健康體育音樂藝術"
));

export function isSimplifiedCandidate(character: string): boolean {
  return Array.from(character).length === 1 && !TRADITIONAL_ONLY.has(character);
}
