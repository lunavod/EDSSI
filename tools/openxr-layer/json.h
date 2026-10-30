// Just enough JSON to read the rig state EDSSI sends (protocol.ts `stateMessage`): objects, arrays,
// numbers, strings, booleans and null. Not a general parser; malformed input yields a null value.

#pragma once

#include <cstdlib>
#include <map>
#include <memory>
#include <string>
#include <vector>

namespace edssi_xr {

struct Json {
  enum Kind { Null, Bool, Number, String, Array, Object } kind = Null;
  bool boolean = false;
  double number = 0;
  std::string text;
  std::vector<Json> items;
  std::map<std::string, Json> fields;

  const Json &operator[](const std::string &key) const {
    static const Json none;
    auto found = fields.find(key);
    return found == fields.end() ? none : found->second;
  }
  double Num(double fallback = 0) const { return kind == Number ? number : fallback; }
  bool Truthy(bool fallback) const { return kind == Bool ? boolean : fallback; }

  static Json Parse(const std::string &source) {
    size_t at = 0;
    Json value = ParseValue(source, at);
    return value;
  }

 private:
  static void Skip(const std::string &s, size_t &at) {
    while (at < s.size() && (s[at] == ' ' || s[at] == '\n' || s[at] == '\r' || s[at] == '\t')) at++;
  }

  static Json ParseValue(const std::string &s, size_t &at) {
    Skip(s, at);
    Json v;
    if (at >= s.size()) return v;
    char c = s[at];
    if (c == '{') {
      v.kind = Object;
      at++;
      Skip(s, at);
      if (at < s.size() && s[at] == '}') {
        at++;
        return v;
      }
      while (at < s.size()) {
        Skip(s, at);
        Json key = ParseValue(s, at);
        Skip(s, at);
        if (key.kind != String || at >= s.size() || s[at] != ':') return Json();
        at++;
        v.fields[key.text] = ParseValue(s, at);
        Skip(s, at);
        if (at < s.size() && s[at] == ',') {
          at++;
          continue;
        }
        if (at < s.size() && s[at] == '}') {
          at++;
          return v;
        }
        return Json();
      }
      return Json();
    }
    if (c == '[') {
      v.kind = Array;
      at++;
      Skip(s, at);
      if (at < s.size() && s[at] == ']') {
        at++;
        return v;
      }
      while (at < s.size()) {
        v.items.push_back(ParseValue(s, at));
        Skip(s, at);
        if (at < s.size() && s[at] == ',') {
          at++;
          continue;
        }
        if (at < s.size() && s[at] == ']') {
          at++;
          return v;
        }
        return Json();
      }
      return Json();
    }
    if (c == '"') {
      v.kind = String;
      at++;
      while (at < s.size() && s[at] != '"') {
        if (s[at] == '\\' && at + 1 < s.size()) {
          char e = s[at + 1];
          at += 2;
          switch (e) {
            case 'n': v.text += '\n'; break;
            case 't': v.text += '\t'; break;
            case 'r': v.text += '\r'; break;
            case 'b': v.text += '\b'; break;
            case 'f': v.text += '\f'; break;
            case 'u': {
              // Ids are ASCII; anything else is kept as a '?', which is all a lookup needs.
              at += 4;
              v.text += '?';
              break;
            }
            default: v.text += e;
          }
          continue;
        }
        v.text += s[at++];
      }
      at++;
      return v;
    }
    if (s.compare(at, 4, "true") == 0) {
      at += 4;
      v.kind = Bool;
      v.boolean = true;
      return v;
    }
    if (s.compare(at, 5, "false") == 0) {
      at += 5;
      v.kind = Bool;
      return v;
    }
    if (s.compare(at, 4, "null") == 0) {
      at += 4;
      return v;
    }
    char *end = nullptr;
    double n = strtod(s.c_str() + at, &end);
    if (end == s.c_str() + at) return v;
    at = static_cast<size_t>(end - s.c_str());
    v.kind = Number;
    v.number = n;
    return v;
  }
};

}  // namespace edssi_xr
