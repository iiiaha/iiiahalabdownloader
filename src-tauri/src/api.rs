use crate::error::{AppError, AppResult};
use serde::{Deserialize, Serialize};
use std::time::Duration;

#[cfg(not(feature = "dev"))]
pub const BASE_URL: &str = "https://iiiahalab.com";
#[cfg(feature = "dev")]
pub const BASE_URL: &str = "http://localhost:3000";

const USER_AGENT: &str =
    concat!("iiiahalab-downloader/", env!("CARGO_PKG_VERSION"));

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Product {
    pub slug: String,
    pub name: String,
    #[serde(rename = "type")]
    pub kind: String,
    pub platform: Option<String>,
    pub version: Option<String>,
    pub file_key: Option<String>,
    pub thumbnail_url: Option<String>,
    pub sort_order: Option<i32>,
    pub subtitle: Option<String>,
    pub description: Option<String>,
}

fn client() -> AppResult<reqwest::Client> {
    Ok(reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .timeout(Duration::from_secs(30))
        .build()?)
}

/// 사이트의 활성 익스텐션 목록 + 최신 버전을 반환한다. 익명 호출.
pub async fn fetch_products() -> AppResult<Vec<Product>> {
    let url = format!("{BASE_URL}/api/products");
    let resp = client()?.get(&url).send().await?;
    let status = resp.status();
    if !status.is_success() {
        return Err(AppError::Msg(format!(
            "GET {url} failed with status {status}"
        )));
    }
    let products: Vec<Product> = resp.json().await?;
    Ok(products)
}

/// .rbz 파일을 다운로드해 바이트로 반환한다. 익명 호출.
/// 호출자가 로컬 캐시에 저장하는 책임을 가진다.
pub async fn download_rbz(slug: &str) -> AppResult<Vec<u8>> {
    let url = format!("{BASE_URL}/api/public/download/{slug}");
    let resp = client()?.get(&url).send().await?;
    let status = resp.status();
    if !status.is_success() {
        return Err(AppError::Msg(format!(
            "GET {url} failed with status {status}"
        )));
    }
    let bytes = resp.bytes().await?;
    Ok(bytes.to_vec())
}

#[tauri::command]
pub async fn cmd_fetch_products() -> AppResult<Vec<Product>> {
    fetch_products().await
}
