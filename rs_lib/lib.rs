use std::borrow::Cow;

use console_static_text::ConsoleSize;
use console_static_text::ConsoleStaticText;
use console_static_text::TextItem;
use serde::Deserialize;
use wasm_bindgen::prelude::*;

#[derive(Deserialize)]
#[serde(untagged)]
pub enum WasmTextItem {
  Text(String),
  HangingText { text: String, indent: Option<u16> },
}

impl WasmTextItem {
  pub fn as_text_item(&self) -> TextItem {
    match self {
      WasmTextItem::Text(text) => TextItem::Text(Cow::Borrowed(text.as_str())),
      WasmTextItem::HangingText { text, indent } => TextItem::HangingText {
        text: Cow::Borrowed(text.as_str()),
        indent: indent.unwrap_or(0),
      },
    }
  }
}

#[wasm_bindgen]
pub struct StaticTextContainer {
  text: ConsoleStaticText,
}

#[wasm_bindgen]
impl StaticTextContainer {
  #[wasm_bindgen(constructor)]
  pub fn new() -> Self {
    Self {
      text: ConsoleStaticText::new(|| ConsoleSize {
        cols: None,
        rows: None,
      }),
    }
  }

  pub fn render_text(
    &mut self,
    items: JsValue,
    cols: Option<usize>,
    rows: Option<usize>,
  ) -> Result<Option<String>, JsValue> {
    let items: Vec<WasmTextItem> = serde_wasm_bindgen::from_value(items)?;
    let items = items.iter().map(|t| t.as_text_item()).collect::<Vec<_>>();
    Ok(self.text.render_items_with_size(
      items.iter(),
      ConsoleSize {
        cols: cols.map(|c| c as u16),
        rows: rows.map(|c| c as u16),
      },
    ))
  }

  pub fn clear_text(
    &mut self,
    cols: Option<usize>,
    rows: Option<usize>,
  ) -> Option<String> {
    self.text.render_clear_with_size(ConsoleSize {
      cols: cols.map(|c| c as u16),
      rows: rows.map(|c| c as u16),
    })
  }
}

#[wasm_bindgen]
pub fn static_text_render_once(
  items: JsValue,
  cols: Option<usize>,
  rows: Option<usize>,
) -> Result<Option<String>, JsValue> {
  let items: Vec<WasmTextItem> = serde_wasm_bindgen::from_value(items)?;
  let items = items.iter().map(|t| t.as_text_item()).collect::<Vec<_>>();
  let mut static_text = ConsoleStaticText::new(move || ConsoleSize {
    cols: cols.map(|c| c as u16),
    rows: rows.map(|c| c as u16),
  });
  Ok(static_text.render_items(items.iter()))
}

#[wasm_bindgen]
pub fn strip_ansi_codes(text: String) -> String {
  console_static_text::ansi::strip_ansi_codes(&text).to_string()
}
