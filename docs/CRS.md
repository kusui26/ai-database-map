# CRS（座標参照系）の取り扱いガイド

本プロジェクト（AI Database Map）で日本のオープンデータを扱う際の、**CRS の統一方針と操作ごとの使い分け**をまとめる。
データ整形は主に `script/create_dataset_for_AI_Database_Map.ipynb` で行い、既存の `script/open_data.ipynb` の実装を踏襲する。

---

## 結論（TL;DR）

CRS に「唯一の最適」は存在しない。**操作ごとに正しい CRS へ変換して使い分ける**のが正解。

| 操作 | 使う CRS | 理由 |
|------|---------|------|
| **格納・結合・地図表示** | **EPSG:6668**（JGD2011 地理座標 / 緯度経度） | 日本政府系オープンデータの標準。再投影誤差を増やさない |
| **面積・バッファ・人口按分（全国一括）** | **正積図法（Albers 等積）** | 全国で面積比を一貫して扱える |
| **2点間の距離・最寄り探索** | 投影せず緯度経度のまま **測地線距離**（`geopy.geodesic`） | 楕円体上の距離で最も正確 |
| **県スケールの精密な距離・面積** | **平面直角座標系（EPSG:6669〜6687）** | 地域単位なら最高精度 |
| **DB（Supabase / PostGIS）格納** | **EPSG:4326（WGS84）= SRID 4326** | PostGIS / MapLibre / GeoJSON の事実上の標準 |

> 一言でいえば **「保持は 6668、面積系は正積投影、距離は測地線、DB は 4326」**。

---

## 基礎知識

### 地理座標系 vs 投影座標系
- **地理座標系（緯度経度・単位は度）**: EPSG:6668(JGD2011), EPSG:4326(WGS84) など。
  - 位置の保持・結合・地図表示に使う。
  - ⚠️ **度のまま `.buffer()` や `.area` を呼んではいけない**（単位が「度」になり無意味）。
- **投影座標系（単位はメートル）**: 平面直角座標系、正積図法など。
  - 距離・面積・バッファなど**メートルが必要な計算**の前に変換する。

### 日本の主要 CRS
| EPSG | 名称 | 測地系 | 用途 |
|------|------|--------|------|
| 6668 | JGD2011 地理座標 | JGD2011 | 国土数値情報・国勢調査などの標準。**マスター CRS** |
| 4326 | WGS84 地理座標 | WGS84 | GPS / GeoJSON / PostGIS / Web 地図の標準 |
| 6669〜6687 | 平面直角座標系 I〜XIX系 | JGD2011 | 地域単位の精密な距離・面積 |
| 3857 | Web メルカトル | WGS84 | タイル地図表示**のみ** |

> **6668 と 4326 の違い**: 測地系（JGD2011 と WGS84）が異なるが、日本国内での実差は 1m 未満。混在させず、整形中は 6668 に統一する。

---

## `open_data.ipynb` での実装（踏襲する方針）

既存ノートブックは 2 段構えで CRS を使い分けている。

### 1. 基準座標は EPSG:6668 で保持
緯度経度から点ジオメトリを作り、ポリゴンともに JGD2011 を明示設定する。

```python
# 駅（点）: 緯度経度から geometry を作成し JGD2011 を設定
df_merged['geometry'] = gpd.points_from_xy(df_merged['longitude'], df_merged['latitude'])
df_merged = gpd.GeoDataFrame(df_merged, geometry='geometry', crs='EPSG:6668')

# 人口境界（ポリゴン）も JGD2011 を設定
df_population_boundary_2020 = gpd.GeoDataFrame(
    df_population_boundary_2020, geometry='geometry', crs='EPSG:6668'
)
```

### 2. 面積・バッファ・人口按分は正積図法へ変換
全国一括で面積比を扱うため、日本に合わせた **Albers 正積図法** に `to_crs` してから計算する。

```python
# 日本に適したカスタム Albers 等積投影
custom_equal_area_crs = {
    'proj': 'aea',
    'lat_1': 29.5,   # 標準緯線1
    'lat_2': 45.5,   # 標準緯線2
    'lat_0': 35,     # 原点の緯度
    'lon_0': 135,    # 原点の経度
    'x_0': 0, 'y_0': 0,
    'ellps': 'GRS80',
    'units': 'm',
}

# メートル単位の投影へ変換してからバッファ・面積・オーバーレイ
df_merged_ea  = df_merged.to_crs(custom_equal_area_crs)
df_pop_ea     = df_population_boundary_2020.to_crs(custom_equal_area_crs)

df_merged_ea['buffer_2km'] = df_merged_ea.buffer(2000)          # メートル指定が効く
df_pop_ea['original_area']  = df_pop_ea.area                    # 正しい面積（m²）

intersection = gpd.overlay(df_pop_ea, buffers, how='intersection')
intersection['area_ratio'] = intersection.area / intersection['original_area']
# 面積比で人口を按分して駅ごとに集計（駅周辺人口）
```

### 3. 2点間の距離は測地線で計算
投影せず、緯度経度のまま楕円体距離を計算する。

```python
from geopy.distance import geodesic

def calculate_distance(lat1, lon1, lat2, lon2):
    """2点間の距離を km で返す"""
    return geodesic((lat1, lon1), (lat2, lon2)).km
```

---

## 操作別レシピ

### A. データ読み込み直後
- ソースの CRS を必ず確認する: `gdf.crs`
- CRS が未設定で緯度経度だと分かっている場合のみ `set_crs("EPSG:6668")`。
- **既に CRS があるデータの変換は `to_crs()`**（`set_crs` は座標を動かさずラベルだけ付け替えるので誤用注意）。

```python
print(gdf.crs)                       # 確認
gdf = gdf.to_crs("EPSG:6668")        # マスターへ統一（変換）
```

### B. 複数データの結合（merge / sjoin）
- **結合前に全レイヤを EPSG:6668 に揃える**。`sjoin` は CRS 不一致だとエラー/誤結果になる。
- 属性結合（駅コード等のキー）は CRS 非依存だが、空間結合（`sjoin`）は必須。

### C. バッファ・面積・オーバーレイ（駅周辺集計）
1. 対象レイヤを正積投影へ `to_crs(custom_equal_area_crs)`
2. `.buffer(メートル)` / `.area` / `gpd.overlay(...)`
3. 集計が終わったらマスター（6668）に戻すか、結果の数値だけ取り出す

### D. 距離・最寄り探索（駅 ↔ 地価公示 L01 点など）
- 少数の2点間距離 → `geopy.geodesic`（緯度経度のまま）
- 大量の最寄り計算 → 平面直角座標系（地域の系を選択）へ投影して `sindex` / `nearest` を使うと高速かつ正確。

### E. DB（Supabase / PostGIS）へ格納・地図表示
- **EPSG:4326（SRID 4326）** に変換して投入する（PostGIS・MapLibre・GeoJSON の標準）。
- 距離・面積は DB 側で `geography` 型や `ST_Transform` を使って計算する。

```python
gdf.to_crs("EPSG:4326").to_file("output.geojson", driver="GeoJSON")
```

---

## アンチパターン（やってはいけないこと）

- ❌ 緯度経度（度）のまま `.buffer()` / `.area` を呼ぶ → 単位が「度」になり無意味。
- ❌ Web メルカトル（3857）で距離・面積を計算 → 日本緯度で面積が数十%膨張。**表示専用**。
- ❌ CRS の異なるレイヤをそのまま `sjoin` / `overlay` → ズレ・エラー。先に統一する。
- ❌ `set_crs` と `to_crs` の混同 → `set_crs` はラベル付けのみ、`to_crs` が実変換。
- ❌ 整形パイプラインの途中で 4326 と 6668 を混在 → 統一してから進める。

---

## チェックリスト

- [ ] 読み込み後に `gdf.crs` を確認したか
- [ ] 全レイヤをマスター CRS（EPSG:6668）に統一してから結合したか
- [ ] 面積・バッファ計算の前に正積投影（メートル）へ変換したか
- [ ] 距離は測地線 or 平面直角座標系で計算したか（度のままにしていないか）
- [ ] DB / 地図出力は EPSG:4326 へ変換したか

---

## 参考
- 国土数値情報（国土交通省） … 駅別乗降客数 S12、地価公示 L01 など。標準は JGD2011。
- 平面直角座標系の系（I〜XIX）と対象地域 … 国土地理院。
- EPSG:6668 = JGD2011 地理座標 / EPSG:6669〜6687 = JGD2011 平面直角座標系。
