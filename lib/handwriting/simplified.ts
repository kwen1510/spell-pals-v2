// Unicode does not provide a reliable "simplified Chinese" property because most
// Han characters are shared between writing systems. Keep shared characters and
// exclude common traditional-only forms instead of converting recognition output.
// The recognizer must describe the submitted ink, never rewrite it.
const TRADITIONAL_ONLY = new Set(Array.from(
  "聽寫師飛場機國學車門馬魚鳥龍龜雲電風間時後裡這們來見說話謝請問對錯號處體頭驗認識讀書畫點線開關長興愛歡樂寶貝錢買賣飯氣燈紅綠藍廣東灣臺萬億個幾隻條張顆邊過進遠從給會應該為麼樣實畢業醫藥廠橋樓樹葉閉舊親爺媽孫兒與無現發產經濟歷術網絡資訊軟設計創運動藝"
));

const SINGLE_HAN_CHARACTER = /^\p{Script=Han}$/u;

export function isSimplifiedCandidate(character: string): boolean {
  return SINGLE_HAN_CHARACTER.test(character) && !TRADITIONAL_ONLY.has(character);
}
