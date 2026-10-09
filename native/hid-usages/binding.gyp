{
  "targets": [
    {
      "target_name": "hid_usages",
      "sources": ["src/hid-usages.c"],
      "libraries": ["hid.lib"],
      "defines": ["NAPI_VERSION=8", "_CRT_SECURE_NO_WARNINGS"],
      "conditions": [["OS!='win'", {"sources": []}]]
    }
  ]
}
