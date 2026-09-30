from app.services.diagnostics import user_agent_category


def test_device_category_recognizes_mobile_safari_and_android_chrome():
    iphone_safari = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1"
    ipad_safari_desktop_mode = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15 Mobile/15E148"
    android_chrome = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/126.0.0.0 Mobile Safari/537.36"

    assert user_agent_category(iphone_safari) == "ios_safari"
    assert user_agent_category(ipad_safari_desktop_mode) == "ios_safari"
    assert user_agent_category(android_chrome) == "android_chrome"
