<?php
// public/proxy.php
header("Access-Control-Allow-Origin: *");
header("Content-Type: application/json; charset=UTF-8");
header("Access-Control-Allow-Methods: POST");

// 讀取 .env 的 helper 函式
function getEnvValue($key) {
    $envFile = __DIR__ . '/.env.local';
    if (!file_exists($envFile)) return null;
    $lines = file($envFile, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
    foreach ($lines as $line) {
        if (strpos(trim($line), '#') === 0) continue;
        if (strpos($line, '=') !== false) {
            list($name, $value) = explode('=', $line, 2);
            if (trim($name) === $key) return trim(trim($value), "\"'");
        }
    }
    return null;
}

$apiKey = getEnvValue('GEMINI_API_KEY');

if (!$apiKey) {
    http_response_code(500);
    echo json_encode(["error" => "Server API Key missing in .env"]);
    exit;
}

$input = json_decode(file_get_contents("php://input"), true);
$action = $input['action'] ?? '';
$payload = $input['payload'] ?? [];
$model = getEnvValue('GEMINI_MODEL') ?: "gemini-1.5-flash";
$url = "https://generativelanguage.googleapis.com/v1beta/models/$model:generateContent?key=$apiKey";

$data = [];
if ($action === 'transcribe') {
    $data = ["contents" => [[ "parts" => [
        ["inlineData" => ["mimeType" => "audio/wav", "data" => $payload['audioBase64']]],
        ["text" => $payload['prompt']]
    ]]]];
} else {
    $data = ["contents" => [[ "parts" => [["text" => $payload['prompt']]]]]];
}

$ch = curl_init($url);
curl_setopt($ch, CURLOPT_POST, true);
curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($data));
curl_setopt($ch, CURLOPT_HTTPHEADER, ['Content-Type: application/json']);
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
$response = curl_exec($ch);
if (curl_errno($ch)) {
    http_response_code(500);
    echo json_encode(["error" => "Curl Error: " . curl_error($ch)]);
} else {
    echo $response;
}
curl_close($ch);
?>