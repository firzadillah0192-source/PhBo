def test_dynamic_api_json_and_errors_are_not_cacheable(client):
    for path in ["/api/templates", "/api/advanced/frame-styles", "/api/generations/missing-cache-test", "/api/account/usage"]:
        response = client.get(path)
        assert "private" in response.headers["cache-control"]
        assert "no-store" in response.headers["cache-control"]
        assert response.headers["cdn-cache-control"] == "no-store"
        assert response.headers["cloudflare-cdn-cache-control"] == "no-store"
        assert "Cookie" in response.headers["vary"]


def test_upload_and_generation_post_keep_no_store_on_validation_errors(client):
    for path in ["/api/uploads", "/api/generations"]:
        response = client.post(path, json={})
        assert response.status_code == 422
        assert "no-store" in response.headers["cache-control"]
