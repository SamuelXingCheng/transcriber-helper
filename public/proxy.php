<?php
// public/proxy.php
header("Access-Control-Allow-Origin: *");
header("Content-Type: application/json; charset=UTF-8");
header("Access-Control-Allow-Methods: POST");
header("Access-Control-Allow-Headers: Content-Type");

// 1. 讀取獨立的 config.php
$configPath = __DIR__ . '/config.php';
if (!file_exists($configPath)) {
    http_response_code(500);
    echo json_encode(["error" => "伺服器設定檔 (config.php) 缺失，請聯繫管理員"]);
    exit;
}

$config = require $configPath;

// [修正點] 統一變數名稱為 $apiKey
$apiKey = $config['GEMINI_API_KEY'] ?? null;
$model  = $config['GEMINI_MODEL'] ?? "gemini-3-flash-preview";

if (!$apiKey) {
    http_response_code(500);
    echo json_encode(["error" => "金鑰未在 config.php 中設定"]);
    exit;
}

// 2. 取得前端傳來的資料
$inputJSON = file_get_contents("php://input");
$input = json_decode($inputJSON, true);
$action = $input['action'] ?? '';
$payload = $input['payload'] ?? [];

// [修正點] 確保 URL 使用正確的 $apiKey 變數
$url = "https://generativelanguage.googleapis.com/v1beta/models/$model:generateContent?key=" . $apiKey;

$data = [];
// 3. 根據 action 封裝資料結構
if ($action === 'transcribe') {
    // 聽抄任務包含音訊 Base64
    $data = ["contents" => [[ "parts" => [
        ["inlineData" => ["mimeType" => "audio/wav", "data" => $payload['audioBase64']]],
        ["text" => $payload['prompt']]
    ]]]];
} else {
    // 純文字任務 (潤稿、翻譯、總結)
    $data = ["contents" => [[ "parts" => [["text" => $payload['prompt']]]]]];
}

// 4. 發送 CURL 請求
$ch = curl_init($url);
curl_setopt($ch, CURLOPT_POST, true);
curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($data));
curl_setopt($ch, CURLOPT_HTTPHEADER, ['Content-Type: application/json']);
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
// 增加超時時間，避免大型檔案處理失敗
curl_setopt($ch, CURLOPT_TIMEOUT, 120); 

$response = curl_exec($ch);

if (curl_errno($ch)) {
    http_response_code(500);
    echo json_encode(["error" => "Curl Error: " . curl_error($ch)]);
} else {
    // 這裡直接將 Google 的原始回應回傳給前端
    echo $response;
}
curl_close($ch);
?>