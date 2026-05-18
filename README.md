# VITAL (**V**oice-based **I**ntelligent **T**riage & **A**mbulance **L**ink)

서울시 응급의료정보 OpenAPI를 기반으로, **구급대원(Paramedic)** 을 위한 응급환자 **병원 분류(트리아지)·추천 시스템입니다.**

음성 또는 텍스트로 환자의 정보를 입력받아 자동으로 KTAS를 분류 하고 **KTAS, 주증상, 위치 정보**를 바탕으로,  
서울 시내 응급의료기관의 **실시간 병상 / 중증질환 수용 정보 / 장비 가용성**을 종합해 환자에게 적합한 병원을 추천하는 것을 목표로 합니다.

---

## 1. 주요 시스템 구조

![uml_png](/assets/uml.png)

- 서울시 응급의료정보 OpenAPI 파싱&래핑
  - 실시간 응급실/중환자실 병상 정보 조회
  - 응급의료기관 기본 정보(주소, 전화, 위경도 등)
  - 중증질환 수용 가능 정보 (MKioskTy1~27)
  - 응급실/중증 관련 메시지 (장비 고장, 병상 과밀, 수용불가 등)
  - 권역외상센터 목록 조회

- 병원 단위 통합 요약 모델 (`HospitalSummary`)
  - 기본정보 + 실시간 병상 + 중증 수용 정보 + 메시지 + 외상센터 여부를 하나로 묶어서 반환
  - 병원별 **수술/시술 능력(procedure group)** 및 가용 병상 계산

- 10개 주증상 카테고리 기반 트리아지
  ```text
  1. 가슴 통증 (Chest pain)
  2. 호흡곤란 (Dyspnea / Respiratory distress)
  3. 신경학적 증상 (Stroke-like symptoms: 편마비, 말어눌함, 경련)
  4. 복통 / 소화기 증상 (Abdominal pain / GI bleeding / vomiting)
  5. 출혈 (External bleeding / hematemesis / melena)
  6. 의식 변화 (Altered mental status / syncope)
  7. 외상 (Trauma: 교통사고, 낙상, 절단, 화상 포함)
  8. 산부인과 응급 (OB-GYN emergency: 분만, 산과/부인과 통증)
  9. 소아 응급 (Pediatric acute illness: 열, 경련, 탈수 등)
  10. 정신과적 응급 (Psychiatric emergency: 자살위험, 폭력성, 급성정신병)
  ```
  - 각 주증상 → 필요한 수술/시술 그룹(procedure groups)으로 매핑
  - 실시간 병상 + pending assignment를 고려한 **effective beds** 계산

- 병원 추천 API
  - 입력: `KTAS`, `complaint_id(주증상)`, `sido`, `sigungu`, (옵션) `home_hpid`
  - 출력: 추천 병원 리스트 + 각 병원의 추천 사유 요약(reason summary)

---

## 2. 기술 스택

- **Backend Framework**: FastAPI
- **Language**: Python 3.11+
- **Config / Env**: `python-dotenv` (.env)
- **HTTP Client**: `requests`
- **XML Parsing**: `xmltodict`
- **Data Model**: Pydantic (BaseModel)
- **Front Framework**: Vite + React + TypeScript

---

## 3. 디렉토리 / 모듈 구조

주요 모듈과 역할은 다음과 같습니다:

- `app/main.py`
  - FastAPI 엔트리포인트
  - `/health`, `/api/hospitals/*`, `/api/triage/recommend` 등 주요 엔드포인트 정의
  - 시·군·구 단위 병원 요약 생성, 트리아지 요청 처리 로직 포함

- `app/services/ermct_client.py`
  - 서울시 응급의료정보 OpenAPI 래퍼
  - `get_realtime_beds`, `get_basic_info`, `get_serious_acceptance`,
    `get_emergency_messages`, `get_trauma_centers` 등 HTTP 호출 + XML 파싱 담당

- `app/schemas.py`
  - Pydantic 데이터 모델 정의
  - `HospitalRealtime`, `HospitalBasicInfo`, `SeriousDiseaseStatus`,
    `HospitalMessage`, `HospitalSummary`,
    `TriageRequest`, `RecommendedHospital` 등

- `app/complaint_mapping.py`
  - 10개 **주증상 카테고리(COMPLAINT_LABELS)** 정의
  - 공공데이터의 `MKioskTyXX` → 주증상 카테고리 ID 매핑
  - 각 주증상 → 필요한 수술/시술 그룹 리스트 매핑
    (예: 가슴 통증 → `ACS_MI`, `AORTIC_EMERGENCY`, `IR_INTERVENTION`)

- `app/procedure_groups.py`
  - 수술/시술 그룹(Procedure Group) 정의
    - 예: `ACS_MI`, `ACS_STROKE`, `ABDOMINAL_EMERGENCY`,
      `GI_ENDOSCOPY`, `OB_EMERGENCY`, `PSYCHIATRIC_EMERGENCY` 등
  - 각 그룹별로
    - 라벨(화면용 이름)
    - 참조할 MKioskTy 키
    - 메시지 코드(Y코드)
    - 관련 병상 타입 리스트(`bed_types`: `er`, `icu_general`, `or` 등)
  - 병원 메시지 차단 여부 등을 고려해
    **병원별 수술/시술 가능 여부 계산 함수** 제공

- `app/config_beds.py`
  - 공공데이터 원시 필드(hv*, hvs*)를  
    도메인 병상 타입(`er`, `or`, `icu_general`, `icu_neonatal`, `ward_psych` 등)으로 맵핑
  - `BED_TYPE_FUNCS`: 각 bed_type → 실시간 가용병상 계산 함수

- `app/triage_utils.py`
  - 병상 가용성 계산 유틸
    - 특정 `bed_types`에 대해 API 기준 가용 병상 / pending 반영한 effective beds 계산
    - 여러 procedure group의 `bed_types` 합집합으로 effective beds 계산
  - `choose_primary_bed_type`: 예약 시 사용될 대표 bed_type 선택 로직
  - `procedure_status_for_hospital`: 한 병원에 대해 group별 병상 상태 정리

- `app/state_assignments.py`
  - 메모리 상의 **pending assignments** 상태 관리
  - `pending_assignments[hpid][bed_type] = 현재 그 병원 해당 병상으로 보내기로 한 환자 수`
  - 현재 병원으로 향하는 환자가 있는 경우 일부 병상의 수를 감산하는 것을 통해 안정성을 올림

- `app/config.py`
  - `.env`에서 `ERMCT_SERVICE_KEY` 로딩
  - 값이 없을 경우 RuntimeError 발생 (환경 변수 필수)

---

## 환경 변수 메모

- 백엔드 예시는 루트 `.env.example` 에 정리되어 있습니다.
- 프론트엔드 Vite 앱의 실제 프로젝트 루트는 `front` 이므로, 브라우저에서 사용할 키는 `front/.env` 에 넣어야 합니다.
- Vite 환경 변수는 반드시 `VITE_` prefix가 필요합니다.
- 프론트 예시는 `front/.env.example` 를 참고하세요.
- `.env`를 수정한 뒤에는 Vite 개발 서버를 재시작해야 새 값이 반영됩니다.

---

## 4. API 엔드포인트 정리

### 4.1 Health Check

- `GET /health`
  - 단순 상태 확인용 (`{"status": "ok"}`)

### 4.2 병원 정보 기본/실시간/중증

- `GET /api/hospitals/realtime`
  - **설명**: 특정 시/군/구 기준 실시간 응급실/중환자실 병상 정보 조회
  - **쿼리 파라미터**
    - `sido`: 시도명 (예: `서울특별시`)
    - `sigungu`: 시군구명 (예: `강남구`)
    - `num_rows`: 최대 병원 수 (기본 50)

- `GET /debug/hospitals/realtime/xml`
  - **설명**: `getEmrrmRltmUsefulSckbdInfoInqire` API의 **원시 XML** 확인용 디버그 엔드포인트
  - **쿼리 파라미터**
    - `sido`, `sigungu`: 위와 동일
    - `num_rows` (int, 기본 5)
    - `page_no` (int, 기본 1)

- `GET /debug/hospitals/serious/xml`
  - **설명**: `getSrsillDissAceptncPosblInfoInqire` Operation의 **원시 XML** 확인용
    - **쿼리 파라미터**
      - `sido`, `sigungu`, `sm_type`, `num_rows`, `page_no`

- `GET /api/hospitals/basic`
  - **설명**: HPID 기준 응급의료기관 기본 정보 조회
  - **쿼리 파라미터**
    - `hpid`: 병원 기관 코드 (예: `A1100010`)

- `GET /api/hospitals/serious`
  - **설명**: 중증질환 수용 가능 정보 (MKioskTy1~27) 조회
  - **쿼리 파라미터**
    - `sido`, `sigungu`
    - `sm_type`: 분류 타입 (기본 1)
    - `num_rows`, `page_no`

- `GET /api/hospitals/messages`
  - **설명**: 응급실/중증 관련 메시지(장비고장, 수용불가 등) 조회
  - **쿼리 파라미터**
    - `hpid`
    - `num_rows`, `page_no`

### 4.3 병원 요약 / 지역별 요약

- `GET /api/hospitals/summary`
  - **설명**: 단일 병원(HPID)에 대한 통합 요약 정보
  - **쿼리 파라미터**
    - `hpid` (필수)
    - `sido`, `sigungu` (옵션: 함께 주면 해당 지역의 실시간/중증정보를 같이 묶어줌)
    - `sm_type` (기본 1)

- `GET /api/hospitals/summary/by-region`
  - **설명**: 특정 시/군/구 내 모든 응급의료기관에 대한 요약 리스트
  - **쿼리 파라미터**
    - `sido`, `sigungu`
    - `sm_type` (기본 1)
    - `num_rows` (기본 200)

### 4.4 트리아지 / 병원 추천

- `POST /api/triage/recommend`
  - **설명**: 프리호스피탈 단계의 triage 정보(KTAS + 주증상 + 지역)를 기반으로  
    해당 지역 내 **수술/시술 가능 + 병상 남아있는** 병원만 필터링하여 추천
  - **요청 Body (TriageRequest) 예시**
    ```json
    {
      "ktas": 2,
      "complaint_id": 1,
      "sido": "서울특별시",
      "sigungu": "노원구",
      "home_hpid": "A1100010",
      "note": "가슴통증 1시간 전 발생, 혈압 저하"
    }
    ```
  - **동작 요약**
    1. `complaint_id` → 필요한 procedure group 리스트로 변환
    2. `sido`, `sigungu` 기준 병원 요약 리스트 조회
    3. 각 병원에 대해
       - 해당 procedure group에 대한 수술/시술 가능 여부
       - bed_types 합집합 기준 effective beds 계산
    4. effective beds > 0 인 병원들만 추천 리스트로 반환

### 4.5 트리아지 / 병원 추천 (지역 기준)

- `POST /api/triage/recommend`
  - **설명**: **프리호스피탈 단계용 기본 병원 추천 API**
    - KTAS + complaint + 지역 정보를 받아
    - 수술/시술 가능 + 병상 남아있는 병원만 필터링해서 **간단한 추천 리스트** 반환
  - **요청 Body**: `TriageRequest`
    ```json
    {
      "ktas": 2,
      "complaint_id": 1,
      "sido": "서울특별시",
      "sigungu": "노원구",
      "home_hpid": "A1100010",
      "note": "가슴통증 1시간 전 발생, 혈압 저하"
    }
    ```
  - **응답**: `list[RecommendedHospital]`

- `POST /api/triage/candidates`
  - **설명**: `'가능 수술 기준' 상세 후보 병원 리스트`를 반환하는 디버그용 API
    - 로직은 `/api/triage/recommend`와 비슷하지만,
    - **케이스 정보 + 후보 병원 리스트**를 하나의 객체(`RoutingCandidateResponse`)로 내려줌
  - **요청 Body**: `TriageRequest` (위와 동일 구조)
  - **응답**: `RoutingCandidateResponse`
    - `case`: `RoutingCase` (KTAS, complaint, 필요한 procedure group 목록 등)
    - `hospitals`: `list[RoutingCandidateHospital]`
      - 각 병원별 procedure_beds, groups_with_beds, coverage_score, priority_score, reason_summary 등 상세 정보 포함

  > 사용 용도
  > - `/api/triage/recommend` → 간단한 추천 리스트
  > - `/api/triage/candidates` → **케이스 + 디테일한 후보 병원 정보** (튜닝/로그용)

### 4.6 병상 예약(in-memory) 관리

> 실제 병원 EMR 예약은 아니고, **백엔드 내부 pending_assignments** 상태만 관리하는 용도.

- `POST /api/triage/reservations`
  - **설명**: 선택된 병원에 대해 **이 complaint 환자를 보낸다**는 가상의 예약을 등록
    - complaint → procedure group → bed_types 체인으로 대표 bed_type(보통 ER)을 하나 골라 `pending_assignments[hpid][bed_type]` 값을 증가시킴
    - 이후 effective_beds 계산 시 해당 예약 수만큼 감산됨
  - **요청 Body**: `BedReservationRequest`
    ```json
    {
      "hpid": "A1100010",
      "complaint_id": 1,
      "ktas": 2,
      "num_patients": 1
    }
    ```

- `POST /api/triage/reservations/release`
  - **설명**: 위에서 만든 예약을 **취소/해제**하는 API  
    (환자 미도착, 오접수 등 상황 표현용)
    - 같은 complaint → procedure group → bed_types 체인을 이용해
    - 대표 bed_type의 pending_assignments를 감소시킴
  - **요청 Body**: `BedReleaseRequest`
    ```json
    {
      "hpid": "A1100010",
      "complaint_id": 1,
      "ktas": 2,
      "num_patients": 1
    }
    ```

### 4.7 KTAS 모듈 연동용 라우팅 API (서울 전체)

> 최종적으로 사용할 POST 엔드포인트

- `POST /api/ktas/route/seoul`
  - **설명**: **KTAS 모듈에서 바로 호출하는 전용 라우팅 API**
    - 입력: KTAS 등급 + `chief_complaint` 텍스트 + 평소 다니던 병원(선택)
    - 서울 전체 병원 중
      - chief_complaint → 내부 `complaint_id(1~10)` 매핑
      - 해당 complaint가 요구하는 procedure group을 수용 가능하고
      - 그 기준으로 effective_beds > 0 인 병원만 후보로 필터링
    - 최종적으로 `RoutingCandidateResponse` 형태로 반환
  - **요청 Body**: `KTASRoutingRequest`
    ```json
    {
      "ktas_level": 2,
      "chief_complaint": "가슴 통증",
      "hospital_followup": "A1100010"
    }
    ```
  - **응답**: `RoutingCandidateResponse`
    - `/api/triage/candidates`와 동일한 스키마

---

## 5. 설치 및 실행 방법

### 5.1 사전 준비

- Python 3.11+
- (권장) Poetry
- 자세한 의존성에 대해서는 루트의 `pyproject.toml`을 참고해주세요

### 5.2 환경 변수 설정

루트 디렉토리에 `.env` 파일을 생성하고, 서울시 응급의료정보 OpenAPI 키를 설정합니다.

```env
ERMCT_SERVICE_KEY=여기에_본인_API_키_입력
```


### 실행 명령어

```bash
uvicorn app.main:app --reload --port 8000
```
### Fast API Swagger

Chrome 등의 브라우저에서 아래의 url 입력

```text
http://127.0.0.1:8000/docs
```

## 6. 출력 예제

다음은 Swagger에서 테스트 한 결과입니다.

### 예시 입력

```json
{
  "ktas_level": 2,
  "chief_complaint": "dyspnea",
  "hospital_followup": "서울대학교병원"
}
```


### 출력
```json
{
  "followup_id": "A1100017",
  "case": {
    "ktas": 2,
    "complaint_id": 2,
    "complaint_label": "호흡곤란 (Dyspnea / Respiratory distress)",
    "required_procedure_groups": [
      "ACS_MI",
      "ACS_STROKE",
      "AORTIC_EMERGENCY",
      "BRONCHOSCOPY",
      "GI_ENDOSCOPY"
    ],
    "required_procedure_group_labels": [
      "심근경색/ACS (응급 PCI)",
      "뇌졸중 (재관류/중재)",
      "대동맥 응급(박리/파열)",
      "기관지 내시경",
      "소화기 내시경(출혈 포함)"
    ]
  },
  "hospitals": [
    {
      "id": "A1100001",
      "name": "경희대학교병원",
      "address": "서울특별시 동대문구 경희대로 23 (회기동)",
      "phone": "02-958-8114",
      "emergency_phone": "02-958-8114",
      "latitude": 37.5938765502235,
      "longitude": 127.05183223390303,
      "procedure_beds": {
        "ACS_MI": {
          "api_beds": 10,
          "effective_beds": 10
        },
        "ACS_STROKE": {
          "api_beds": 2,
          "effective_beds": 2
        },
        "AORTIC_EMERGENCY": {
          "api_beds": 0,
          "effective_beds": 0
        },
        "BRONCHOSCOPY": {
          "api_beds": 10,
          "effective_beds": 10
        },
        "GI_ENDOSCOPY": {
          "api_beds": 10,
          "effective_beds": 10
        }
      },
      "total_effective_beds": 27,
      "has_any_bed": true,
      "groups_with_beds": [
        "ACS_MI",
        "ACS_STROKE",
        "BRONCHOSCOPY",
        "GI_ENDOSCOPY"
      ],
      "groups_with_beds_labels": [
        "심근경색/ACS (응급 PCI)",
        "뇌졸중 (재관류/중재)",
        "기관지 내시경",
        "소화기 내시경(출혈 포함)"
      ],
      "supported_complaints": [
        1,
        2,
        3,
        4,
        5,
        6,
        7,
        8,
        9,
        10
      ],
      "supported_complaint_labels": [
        "가슴 통증 (Chest pain)",
        "호흡곤란 (Dyspnea / Respiratory distress)",
        "신경학적 증상 (Stroke-like symptoms: 편마비, 말어눌함, 경련)",
        "복통 / 소화기 증상 (Abdominal pain / GI bleeding / vomiting)",
        "출혈 (External bleeding / hematemesis / melena)",
        "의식 변화 (Altered mental status / syncope)",
        "외상 (Trauma: 교통사고, 낙상, 절단, 화상 포함)",
        "산부인과 응급 (OB-GYN emergency: 분만, 산과/부인과 통증)",
        "소아 응급 (Pediatric acute illness: 열, 경련, 탈수 등)",
        "정신과적 응급 (Psychiatric emergency: 자살위험, 폭력성, 급성정신병)"
      ],
      "mkiosk_flags": [
        "MKioskTy1",
        "MKioskTy11",
        "MKioskTy12",
        "MKioskTy13",
        "MKioskTy15",
        "MKioskTy16",
        "MKioskTy17",
        "MKioskTy18",
        "MKioskTy2",
        "MKioskTy22",
        "MKioskTy23",
        "MKioskTy24",
        "MKioskTy25",
        "MKioskTy26",
        "MKioskTy28",
        "MKioskTy3",
        "MKioskTy4",
        "MKioskTy7",
        "MKioskTy8",
        "MKioskTy9"
      ],
      "coverage_score": 0.8,
      "coverage_level": "HIGH",
      "priority_score": 25.9,
      "reason_summary": "KTAS 2, 주증상 '호흡곤란 (Dyspnea / Respiratory distress)' 환자에 대해 심근경색/ACS (응급 PCI), 뇌졸중 (재관류/중재), 기관지 내시경, 소화기 내시경(출혈 포함) 기준 총 유효 병상 27개가 남아 있어 후보로 선정됨. (시술 커버리지: 핵심 시술 대부분 가능, 약 80% 충족)"
    },
    {
      "id": "A1100007",
      "name": "연세대학교의과대학세브란스병원",
      "address": "서울특별시 서대문구 연세로 50-1 (신촌동)",
      "phone": "02-2228-0114",
      "emergency_phone": "02-2227-7777",
      "latitude": 37.56211711412639,
      "longitude": 126.94082769649863,
      "procedure_beds": {
        "ACS_MI": {
          "api_beds": 6,
          "effective_beds": 6
        },
        "ACS_STROKE": {
          "api_beds": 3,
          "effective_beds": 3
        },
        "AORTIC_EMERGENCY": {
          "api_beds": 6,
          "effective_beds": 6
        },
        "BRONCHOSCOPY": {
          "api_beds": 0,
          "effective_beds": 0
        },
        "GI_ENDOSCOPY": {
          "api_beds": 6,
          "effective_beds": 6
        }
      },
      "total_effective_beds": 27,
      "has_any_bed": true,
      "groups_with_beds": [
        "ACS_MI",
        "ACS_STROKE",
        "AORTIC_EMERGENCY",
        "GI_ENDOSCOPY"
      ],
      "groups_with_beds_labels": [
        "심근경색/ACS (응급 PCI)",
        "뇌졸중 (재관류/중재)",
        "대동맥 응급(박리/파열)",
        "소화기 내시경(출혈 포함)"
      ],
      "supported_complaints": [
        1,
        2,
        3,
        4,
        5,
        6,
        7,
        8,
        9,
        10
      ],
      "supported_complaint_labels": [
        "가슴 통증 (Chest pain)",
        "호흡곤란 (Dyspnea / Respiratory distress)",
        "신경학적 증상 (Stroke-like symptoms: 편마비, 말어눌함, 경련)",
        "복통 / 소화기 증상 (Abdominal pain / GI bleeding / vomiting)",
        "출혈 (External bleeding / hematemesis / melena)",
        "의식 변화 (Altered mental status / syncope)",
        "외상 (Trauma: 교통사고, 낙상, 절단, 화상 포함)",
        "산부인과 응급 (OB-GYN emergency: 분만, 산과/부인과 통증)",
        "소아 응급 (Pediatric acute illness: 열, 경련, 탈수 등)",
        "정신과적 응급 (Psychiatric emergency: 자살위험, 폭력성, 급성정신병)"
      ],
      "mkiosk_flags": [
        "MKioskTy1",
        "MKioskTy10",
        "MKioskTy11",
        "MKioskTy13",
        "MKioskTy14",
        "MKioskTy15",
        "MKioskTy2",
        "MKioskTy22",
        "MKioskTy24",
        "MKioskTy25",
        "MKioskTy26",
        "MKioskTy27",
        "MKioskTy28",
        "MKioskTy3",
        "MKioskTy4",
        "MKioskTy5",
        "MKioskTy6",
        "MKioskTy7",
        "MKioskTy8",
        "MKioskTy9"
      ],
      "coverage_score": 0.8,
      "coverage_level": "HIGH",
      "priority_score": 25.9,
      "reason_summary": "KTAS 2, 주증상 '호흡곤란 (Dyspnea / Respiratory distress)' 환자에 대해 심근경색/ACS (응급 PCI), 뇌졸중 (재관류/중재), 대동맥 응급(박리/파열), 소화기 내시경(출혈 포함) 기준 총 유효 병상 27개가 남아 있어 후보로 선정됨. (시술 커버리지: 핵심 시술 대부분 가능, 약 80% 충족)"
    },
    {
      "id": "A1100014",
      "name": "고려대학교의과대학부속구로병원",
      "address": "서울특별시 구로구 구로동로 148, 고려대부속구로병원 (구로동)",
      "phone": "02-2626-1114",
      "emergency_phone": "02-2626-1550",
      "latitude": 37.49211114525054,
      "longitude": 126.8847449363546,
      "procedure_beds": {
        "ACS_MI": {
          "api_beds": 3,
          "effective_beds": 3
        },
        "ACS_STROKE": {
          "api_beds": 0,
          "effective_beds": 0
        },
        "AORTIC_EMERGENCY": {
          "api_beds": 3,
          "effective_beds": 3
        },
        "BRONCHOSCOPY": {
          "api_beds": 3,
          "effective_beds": 3
        },
        "GI_ENDOSCOPY": {
          "api_beds": 22,
          "effective_beds": 22
        }
      },
      "total_effective_beds": 25,
      "has_any_bed": true,
      "groups_with_beds": [
        "ACS_MI",
        "AORTIC_EMERGENCY",
        "BRONCHOSCOPY",
        "GI_ENDOSCOPY"
      ],
      "groups_with_beds_labels": [
        "심근경색/ACS (응급 PCI)",
        "대동맥 응급(박리/파열)",
        "기관지 내시경",
        "소화기 내시경(출혈 포함)"
      ],
      "supported_complaints": [
        1,
        2,
        3,
        4,
        5,
        6,
        7,
        8,
        9,
        10
      ],
      "supported_complaint_labels": [
        "가슴 통증 (Chest pain)",
        "호흡곤란 (Dyspnea / Respiratory distress)",
        "신경학적 증상 (Stroke-like symptoms: 편마비, 말어눌함, 경련)",
        "복통 / 소화기 증상 (Abdominal pain / GI bleeding / vomiting)",
        "출혈 (External bleeding / hematemesis / melena)",
        "의식 변화 (Altered mental status / syncope)",
        "외상 (Trauma: 교통사고, 낙상, 절단, 화상 포함)",
        "산부인과 응급 (OB-GYN emergency: 분만, 산과/부인과 통증)",
        "소아 응급 (Pediatric acute illness: 열, 경련, 탈수 등)",
        "정신과적 응급 (Psychiatric emergency: 자살위험, 폭력성, 급성정신병)"
      ],
      "mkiosk_flags": [
        "MKioskTy1",
        "MKioskTy10",
        "MKioskTy11",
        "MKioskTy12",
        "MKioskTy13",
        "MKioskTy14",
        "MKioskTy15",
        "MKioskTy16",
        "MKioskTy17",
        "MKioskTy18",
        "MKioskTy2",
        "MKioskTy20",
        "MKioskTy21",
        "MKioskTy22",
        "MKioskTy23",
        "MKioskTy24",
        "MKioskTy25",
        "MKioskTy26",
        "MKioskTy27",
        "MKioskTy28",
        "MKioskTy3",
        "MKioskTy4",
        "MKioskTy5",
        "MKioskTy6",
        "MKioskTy7",
        "MKioskTy8",
        "MKioskTy9"
      ],
      "coverage_score": 0.8,
      "coverage_level": "HIGH",
      "priority_score": 24,
      "reason_summary": "KTAS 2, 주증상 '호흡곤란 (Dyspnea / Respiratory distress)' 환자에 대해 심근경색/ACS (응급 PCI), 대동맥 응급(박리/파열), 기관지 내시경, 소화기 내시경(출혈 포함) 기준 총 유효 병상 25개가 남아 있어 후보로 선정됨. (시술 커버리지: 핵심 시술 대부분 가능, 약 80% 충족)"
    },
    {
      "id": "A1100009",
      "name": "재단법인아산사회복지재단서울아산병원",
      "address": "서울특별시 송파구 올림픽로43길 88, 서울아산병원 (풍납동)",
      "phone": "02-3010-3114",
      "emergency_phone": "02-3010-3333",
      "latitude": 37.526563966361216,
      "longitude": 127.10823825113607,
      "procedure_beds": {
        "ACS_MI": {
          "api_beds": 0,
          "effective_beds": 0
        },
        "ACS_STROKE": {
          "api_beds": 2,
          "effective_beds": 2
        },
        "AORTIC_EMERGENCY": {
          "api_beds": 0,
          "effective_beds": 0
        },
        "BRONCHOSCOPY": {
          "api_beds": 0,
          "effective_beds": 0
        },
        "GI_ENDOSCOPY": {
          "api_beds": 28,
          "effective_beds": 28
        }
      },
      "total_effective_beds": 30,
      "has_any_bed": true,
      "groups_with_beds": [
        "ACS_STROKE",
        "GI_ENDOSCOPY"
      ],
      "groups_with_beds_labels": [
        "뇌졸중 (재관류/중재)",
        "소화기 내시경(출혈 포함)"
      ],
      "supported_complaints": [
        1,
        2,
        3,
        4,
        5,
        6,
        7,
        8,
        9,
        10
      ],
      "supported_complaint_labels": [
        "가슴 통증 (Chest pain)",
        "호흡곤란 (Dyspnea / Respiratory distress)",
        "신경학적 증상 (Stroke-like symptoms: 편마비, 말어눌함, 경련)",
        "복통 / 소화기 증상 (Abdominal pain / GI bleeding / vomiting)",
        "출혈 (External bleeding / hematemesis / melena)",
        "의식 변화 (Altered mental status / syncope)",
        "외상 (Trauma: 교통사고, 낙상, 절단, 화상 포함)",
        "산부인과 응급 (OB-GYN emergency: 분만, 산과/부인과 통증)",
        "소아 응급 (Pediatric acute illness: 열, 경련, 탈수 등)",
        "정신과적 응급 (Psychiatric emergency: 자살위험, 폭력성, 급성정신병)"
      ],
      "mkiosk_flags": [
        "MKioskTy1",
        "MKioskTy10",
        "MKioskTy11",
        "MKioskTy15",
        "MKioskTy16",
        "MKioskTy17",
        "MKioskTy18",
        "MKioskTy2",
        "MKioskTy22",
        "MKioskTy23",
        "MKioskTy24",
        "MKioskTy25",
        "MKioskTy26",
        "MKioskTy28",
        "MKioskTy6",
        "MKioskTy7",
        "MKioskTy8",
        "MKioskTy9"
      ],
      "coverage_score": 0.4,
      "coverage_level": "LOW",
      "priority_score": 23.1,
      "reason_summary": "KTAS 2, 주증상 '호흡곤란 (Dyspnea / Respiratory distress)' 환자에 대해 뇌졸중 (재관류/중재), 소화기 내시경(출혈 포함) 기준 총 유효 병상 30개가 남아 있어 후보로 선정됨. (시술 커버리지: 필수 시술 중 일부만 가능, 약 40% 충족)"
    },
    {
      "id": "A1100043",
      "name": "강동경희대학교의대병원",
      "address": "서울특별시 강동구 동남로 892 (상일동)",
      "phone": "02-440-7114",
      "emergency_phone": "02-440-7000",
      "latitude": 37.5520459324005,
      "longitude": 127.157084787845,
      "procedure_beds": {
        "ACS_MI": {
          "api_beds": 8,
          "effective_beds": 8
        },
        "ACS_STROKE": {
          "api_beds": 0,
          "effective_beds": 0
        },
        "AORTIC_EMERGENCY": {
          "api_beds": 8,
          "effective_beds": 8
        },
        "BRONCHOSCOPY": {
          "api_beds": 8,
          "effective_beds": 8
        },
        "GI_ENDOSCOPY": {
          "api_beds": 15,
          "effective_beds": 15
        }
      },
      "total_effective_beds": 23,
      "has_any_bed": true,
      "groups_with_beds": [
        "ACS_MI",
        "AORTIC_EMERGENCY",
        "BRONCHOSCOPY",
        "GI_ENDOSCOPY"
      ],
      "groups_with_beds_labels": [
        "심근경색/ACS (응급 PCI)",
        "대동맥 응급(박리/파열)",
        "기관지 내시경",
        "소화기 내시경(출혈 포함)"
      ],
      "supported_complaints": [
        1,
        2,
        3,
        4,
        5,
        6,
        7,
        8,
        9
      ],
      "supported_complaint_labels": [
        "가슴 통증 (Chest pain)",
        "호흡곤란 (Dyspnea / Respiratory distress)",
        "신경학적 증상 (Stroke-like symptoms: 편마비, 말어눌함, 경련)",
        "복통 / 소화기 증상 (Abdominal pain / GI bleeding / vomiting)",
        "출혈 (External bleeding / hematemesis / melena)",
        "의식 변화 (Altered mental status / syncope)",
        "외상 (Trauma: 교통사고, 낙상, 절단, 화상 포함)",
        "산부인과 응급 (OB-GYN emergency: 분만, 산과/부인과 통증)",
        "소아 응급 (Pediatric acute illness: 열, 경련, 탈수 등)"
      ],
      "mkiosk_flags": [
        "MKioskTy1",
        "MKioskTy11",
        "MKioskTy13",
        "MKioskTy15",
        "MKioskTy16",
        "MKioskTy17",
        "MKioskTy18",
        "MKioskTy2",
        "MKioskTy21",
        "MKioskTy22",
        "MKioskTy23",
        "MKioskTy25",
        "MKioskTy26",
        "MKioskTy28",
        "MKioskTy3",
        "MKioskTy4",
        "MKioskTy6",
        "MKioskTy9"
      ],
      "coverage_score": 0.8,
      "coverage_level": "HIGH",
      "priority_score": 22.1,
      "reason_summary": "KTAS 2, 주증상 '호흡곤란 (Dyspnea / Respiratory distress)' 환자에 대해 심근경색/ACS (응급 PCI), 대동맥 응급(박리/파열), 기관지 내시경, 소화기 내시경(출혈 포함) 기준 총 유효 병상 23개가 남아 있어 후보로 선정됨. (시술 커버리지: 핵심 시술 대부분 가능, 약 80% 충족)"
    },
    {
      "id": "A1100035",
      "name": "서울특별시서울의료원",
      "address": "서울특별시 중랑구 신내로 156 (신내동)",
      "phone": "02-2276-7000",
      "emergency_phone": "02-2276-7000",
      "latitude": 37.61286931510163,
      "longitude": 127.0980910949257,
      "procedure_beds": {
        "ACS_MI": {
          "api_beds": 2,
          "effective_beds": 2
        },
        "ACS_STROKE": {
          "api_beds": 1,
          "effective_beds": 1
        },
        "AORTIC_EMERGENCY": {
          "api_beds": 2,
          "effective_beds": 2
        },
        "BRONCHOSCOPY": {
          "api_beds": 2,
          "effective_beds": 2
        },
        "GI_ENDOSCOPY": {
          "api_beds": 18,
          "effective_beds": 18
        }
      },
      "total_effective_beds": 21,
      "has_any_bed": true,
      "groups_with_beds": [
        "ACS_MI",
        "ACS_STROKE",
        "AORTIC_EMERGENCY",
        "BRONCHOSCOPY",
        "GI_ENDOSCOPY"
      ],
      "groups_with_beds_labels": [
        "심근경색/ACS (응급 PCI)",
        "뇌졸중 (재관류/중재)",
        "대동맥 응급(박리/파열)",
        "기관지 내시경",
        "소화기 내시경(출혈 포함)"
      ],
      "supported_complaints": [
        1,
        2,
        3,
        4,
        5,
        6,
        7,
        8,
        9,
        10
      ],
      "supported_complaint_labels": [
        "가슴 통증 (Chest pain)",
        "호흡곤란 (Dyspnea / Respiratory distress)",
        "신경학적 증상 (Stroke-like symptoms: 편마비, 말어눌함, 경련)",
        "복통 / 소화기 증상 (Abdominal pain / GI bleeding / vomiting)",
        "출혈 (External bleeding / hematemesis / melena)",
        "의식 변화 (Altered mental status / syncope)",
        "외상 (Trauma: 교통사고, 낙상, 절단, 화상 포함)",
        "산부인과 응급 (OB-GYN emergency: 분만, 산과/부인과 통증)",
        "소아 응급 (Pediatric acute illness: 열, 경련, 탈수 등)",
        "정신과적 응급 (Psychiatric emergency: 자살위험, 폭력성, 급성정신병)"
      ],
      "mkiosk_flags": [
        "MKioskTy1",
        "MKioskTy11",
        "MKioskTy13",
        "MKioskTy15",
        "MKioskTy16",
        "MKioskTy17",
        "MKioskTy18",
        "MKioskTy19",
        "MKioskTy2",
        "MKioskTy22",
        "MKioskTy23",
        "MKioskTy24",
        "MKioskTy26",
        "MKioskTy28",
        "MKioskTy3",
        "MKioskTy4",
        "MKioskTy7",
        "MKioskTy8",
        "MKioskTy9"
      ],
      "coverage_score": 1,
      "coverage_level": "FULL",
      "priority_score": 21.6,
      "reason_summary": "KTAS 2, 주증상 '호흡곤란 (Dyspnea / Respiratory distress)' 환자에 대해 심근경색/ACS (응급 PCI), 뇌졸중 (재관류/중재), 대동맥 응급(박리/파열), 기관지 내시경, 소화기 내시경(출혈 포함) 기준 총 유효 병상 21개가 남아 있어 후보로 선정됨. (시술 커버리지: 요청된 시술을 거의 모두 커버, 약 100% 충족)"
    },
    {
      "id": "A1100015",
      "name": "연세대학교의과대학강남세브란스병원",
      "address": "서울특별시 강남구 언주로 211, 강남세브란스병원 (도곡동)",
      "phone": "02-2019-3114",
      "emergency_phone": "02-2019-3333",
      "latitude": 37.492806984645476,
      "longitude": 127.04631254186798,
      "procedure_beds": {
        "ACS_MI": {
          "api_beds": 7,
          "effective_beds": 7
        },
        "ACS_STROKE": {
          "api_beds": 3,
          "effective_beds": 3
        },
        "AORTIC_EMERGENCY": {
          "api_beds": 7,
          "effective_beds": 7
        },
        "BRONCHOSCOPY": {
          "api_beds": 0,
          "effective_beds": 0
        },
        "GI_ENDOSCOPY": {
          "api_beds": 7,
          "effective_beds": 7
        }
      },
      "total_effective_beds": 21,
      "has_any_bed": true,
      "groups_with_beds": [
        "ACS_MI",
        "ACS_STROKE",
        "AORTIC_EMERGENCY",
        "GI_ENDOSCOPY"
      ],
      "groups_with_beds_labels": [
        "심근경색/ACS (응급 PCI)",
        "뇌졸중 (재관류/중재)",
        "대동맥 응급(박리/파열)",
        "소화기 내시경(출혈 포함)"
      ],
      "supported_complaints": [
        1,
        2,
        3,
        4,
        5,
        6,
        8,
        9
      ],
      "supported_complaint_labels": [
        "가슴 통증 (Chest pain)",
        "호흡곤란 (Dyspnea / Respiratory distress)",
        "신경학적 증상 (Stroke-like symptoms: 편마비, 말어눌함, 경련)",
        "복통 / 소화기 증상 (Abdominal pain / GI bleeding / vomiting)",
        "출혈 (External bleeding / hematemesis / melena)",
        "의식 변화 (Altered mental status / syncope)",
        "산부인과 응급 (OB-GYN emergency: 분만, 산과/부인과 통증)",
        "소아 응급 (Pediatric acute illness: 열, 경련, 탈수 등)"
      ],
      "mkiosk_flags": [
        "MKioskTy1",
        "MKioskTy11",
        "MKioskTy15",
        "MKioskTy16",
        "MKioskTy17",
        "MKioskTy18",
        "MKioskTy2",
        "MKioskTy28",
        "MKioskTy3",
        "MKioskTy4",
        "MKioskTy5",
        "MKioskTy6",
        "MKioskTy7",
        "MKioskTy8",
        "MKioskTy9"
      ],
      "coverage_score": 0.8,
      "coverage_level": "HIGH",
      "priority_score": 20.2,
      "reason_summary": "KTAS 2, 주증상 '호흡곤란 (Dyspnea / Respiratory distress)' 환자에 대해 심근경색/ACS (응급 PCI), 뇌졸중 (재관류/중재), 대동맥 응급(박리/파열), 소화기 내시경(출혈 포함) 기준 총 유효 병상 21개가 남아 있어 후보로 선정됨. (시술 커버리지: 핵심 시술 대부분 가능, 약 80% 충족)"
    },
    {
      "id": "A1100040",
      "name": "서울특별시보라매병원",
      "address": "서울특별시 동작구 보라매로5길 20 (신대방동)",
      "phone": "02-870-2114",
      "emergency_phone": "02-870-2119",
      "latitude": 37.4937184009319,
      "longitude": 126.92404876254014,
      "procedure_beds": {
        "ACS_MI": {
          "api_beds": 0,
          "effective_beds": 0
        },
        "ACS_STROKE": {
          "api_beds": 0,
          "effective_beds": 0
        },
        "AORTIC_EMERGENCY": {
          "api_beds": 0,
          "effective_beds": 0
        },
        "BRONCHOSCOPY": {
          "api_beds": 0,
          "effective_beds": 0
        },
        "GI_ENDOSCOPY": {
          "api_beds": 24,
          "effective_beds": 24
        }
      },
      "total_effective_beds": 24,
      "has_any_bed": true,
      "groups_with_beds": [
        "GI_ENDOSCOPY"
      ],
      "groups_with_beds_labels": [
        "소화기 내시경(출혈 포함)"
      ],
      "supported_complaints": [
        1,
        2,
        3,
        4,
        5,
        6,
        7,
        8,
        9
      ],
      "supported_complaint_labels": [
        "가슴 통증 (Chest pain)",
        "호흡곤란 (Dyspnea / Respiratory distress)",
        "신경학적 증상 (Stroke-like symptoms: 편마비, 말어눌함, 경련)",
        "복통 / 소화기 증상 (Abdominal pain / GI bleeding / vomiting)",
        "출혈 (External bleeding / hematemesis / melena)",
        "의식 변화 (Altered mental status / syncope)",
        "외상 (Trauma: 교통사고, 낙상, 절단, 화상 포함)",
        "산부인과 응급 (OB-GYN emergency: 분만, 산과/부인과 통증)",
        "소아 응급 (Pediatric acute illness: 열, 경련, 탈수 등)"
      ],
      "mkiosk_flags": [
        "MKioskTy1",
        "MKioskTy11",
        "MKioskTy15",
        "MKioskTy16",
        "MKioskTy17",
        "MKioskTy18",
        "MKioskTy2",
        "MKioskTy20",
        "MKioskTy22",
        "MKioskTy23",
        "MKioskTy28",
        "MKioskTy3",
        "MKioskTy4",
        "MKioskTy7"
      ],
      "coverage_score": 0.2,
      "coverage_level": "LOW",
      "priority_score": 18,
      "reason_summary": "KTAS 2, 주증상 '호흡곤란 (Dyspnea / Respiratory distress)' 환자에 대해 소화기 내시경(출혈 포함) 기준 총 유효 병상 24개가 남아 있어 후보로 선정됨. (시술 커버리지: 필수 시술 중 일부만 가능, 약 20% 충족)"
    },
    {
      "id": "A1100005",
      "name": "이화여자대학교의과대학부속목동병원",
      "address": "서울특별시 양천구 안양천로 1071 (목동)",
      "phone": "02-2650-5114",
      "emergency_phone": "02-2650-5911",
      "latitude": 37.53654282637804,
      "longitude": 126.8862159683056,
      "procedure_beds": {
        "ACS_MI": {
          "api_beds": 0,
          "effective_beds": 0
        },
        "ACS_STROKE": {
          "api_beds": 4,
          "effective_beds": 4
        },
        "AORTIC_EMERGENCY": {
          "api_beds": 0,
          "effective_beds": 0
        },
        "BRONCHOSCOPY": {
          "api_beds": 0,
          "effective_beds": 0
        },
        "GI_ENDOSCOPY": {
          "api_beds": 17,
          "effective_beds": 17
        }
      },
      "total_effective_beds": 21,
      "has_any_bed": true,
      "groups_with_beds": [
        "ACS_STROKE",
        "GI_ENDOSCOPY"
      ],
      "groups_with_beds_labels": [
        "뇌졸중 (재관류/중재)",
        "소화기 내시경(출혈 포함)"
      ],
      "supported_complaints": [
        1,
        2,
        3,
        4,
        5,
        6,
        7,
        8,
        9
      ],
      "supported_complaint_labels": [
        "가슴 통증 (Chest pain)",
        "호흡곤란 (Dyspnea / Respiratory distress)",
        "신경학적 증상 (Stroke-like symptoms: 편마비, 말어눌함, 경련)",
        "복통 / 소화기 증상 (Abdominal pain / GI bleeding / vomiting)",
        "출혈 (External bleeding / hematemesis / melena)",
        "의식 변화 (Altered mental status / syncope)",
        "외상 (Trauma: 교통사고, 낙상, 절단, 화상 포함)",
        "산부인과 응급 (OB-GYN emergency: 분만, 산과/부인과 통증)",
        "소아 응급 (Pediatric acute illness: 열, 경련, 탈수 등)"
      ],
      "mkiosk_flags": [
        "MKioskTy1",
        "MKioskTy11",
        "MKioskTy13",
        "MKioskTy15",
        "MKioskTy16",
        "MKioskTy17",
        "MKioskTy18",
        "MKioskTy2",
        "MKioskTy22",
        "MKioskTy23",
        "MKioskTy25",
        "MKioskTy26",
        "MKioskTy27",
        "MKioskTy28",
        "MKioskTy3",
        "MKioskTy4",
        "MKioskTy5",
        "MKioskTy6",
        "MKioskTy7",
        "MKioskTy8",
        "MKioskTy9"
      ],
      "coverage_score": 0.4,
      "coverage_level": "LOW",
      "priority_score": 16.2,
      "reason_summary": "KTAS 2, 주증상 '호흡곤란 (Dyspnea / Respiratory distress)' 환자에 대해 뇌졸중 (재관류/중재), 소화기 내시경(출혈 포함) 기준 총 유효 병상 21개가 남아 있어 후보로 선정됨. (시술 커버리지: 필수 시술 중 일부만 가능, 약 40% 충족)"
    },
    {
      "id": "A1100004",
      "name": "순천향대학교 부속 서울병원",
      "address": "서울특별시 용산구 대사관로 59 (한남동)",
      "phone": "02-709-9114",
      "emergency_phone": "02-709-9117",
      "latitude": 37.53384172231443,
      "longitude": 127.00441798640304,
      "procedure_beds": {
        "ACS_MI": {
          "api_beds": 4,
          "effective_beds": 4
        },
        "ACS_STROKE": {
          "api_beds": 0,
          "effective_beds": 0
        },
        "AORTIC_EMERGENCY": {
          "api_beds": 0,
          "effective_beds": 0
        },
        "BRONCHOSCOPY": {
          "api_beds": 0,
          "effective_beds": 0
        },
        "GI_ENDOSCOPY": {
          "api_beds": 17,
          "effective_beds": 17
        }
      },
      "total_effective_beds": 21,
      "has_any_bed": true,
      "groups_with_beds": [
        "ACS_MI",
        "GI_ENDOSCOPY"
      ],
      "groups_with_beds_labels": [
        "심근경색/ACS (응급 PCI)",
        "소화기 내시경(출혈 포함)"
      ],
      "supported_complaints": [
        1,
        2,
        3,
        4,
        5,
        6,
        7
      ],
      "supported_complaint_labels": [
        "가슴 통증 (Chest pain)",
        "호흡곤란 (Dyspnea / Respiratory distress)",
        "신경학적 증상 (Stroke-like symptoms: 편마비, 말어눌함, 경련)",
        "복통 / 소화기 증상 (Abdominal pain / GI bleeding / vomiting)",
        "출혈 (External bleeding / hematemesis / melena)",
        "의식 변화 (Altered mental status / syncope)",
        "외상 (Trauma: 교통사고, 낙상, 절단, 화상 포함)"
      ],
      "mkiosk_flags": [
        "MKioskTy1",
        "MKioskTy11",
        "MKioskTy2",
        "MKioskTy21",
        "MKioskTy22",
        "MKioskTy23",
        "MKioskTy25",
        "MKioskTy26",
        "MKioskTy28",
        "MKioskTy3",
        "MKioskTy4",
        "MKioskTy6",
        "MKioskTy7",
        "MKioskTy8",
        "MKioskTy9"
      ],
      "coverage_score": 0.4,
      "coverage_level": "LOW",
      "priority_score": 16.2,
      "reason_summary": "KTAS 2, 주증상 '호흡곤란 (Dyspnea / Respiratory distress)' 환자에 대해 심근경색/ACS (응급 PCI), 소화기 내시경(출혈 포함) 기준 총 유효 병상 21개가 남아 있어 후보로 선정됨. (시술 커버리지: 필수 시술 중 일부만 가능, 약 40% 충족)"
    },
    {
      "id": "A1120796",
      "name": "이화여자대학교의과대학부속서울병원",
      "address": "서울특별시 강서구 공항대로 260, 이화의대부속서울병원 (마곡동)",
      "phone": "1522-7000",
      "emergency_phone": "02-6986-5119",
      "latitude": 37.557261149,
      "longitude": 126.8362659275,
      "procedure_beds": {
        "ACS_MI": {
          "api_beds": 0,
          "effective_beds": 0
        },
        "ACS_STROKE": {
          "api_beds": 2,
          "effective_beds": 2
        },
        "AORTIC_EMERGENCY": {
          "api_beds": 0,
          "effective_beds": 0
        },
        "BRONCHOSCOPY": {
          "api_beds": 0,
          "effective_beds": 0
        },
        "GI_ENDOSCOPY": {
          "api_beds": 18,
          "effective_beds": 18
        }
      },
      "total_effective_beds": 20,
      "has_any_bed": true,
      "groups_with_beds": [
        "ACS_STROKE",
        "GI_ENDOSCOPY"
      ],
      "groups_with_beds_labels": [
        "뇌졸중 (재관류/중재)",
        "소화기 내시경(출혈 포함)"
      ],
      "supported_complaints": [
        1,
        2,
        3,
        4,
        5,
        6,
        7,
        8,
        9
      ],
      "supported_complaint_labels": [
        "가슴 통증 (Chest pain)",
        "호흡곤란 (Dyspnea / Respiratory distress)",
        "신경학적 증상 (Stroke-like symptoms: 편마비, 말어눌함, 경련)",
        "복통 / 소화기 증상 (Abdominal pain / GI bleeding / vomiting)",
        "출혈 (External bleeding / hematemesis / melena)",
        "의식 변화 (Altered mental status / syncope)",
        "외상 (Trauma: 교통사고, 낙상, 절단, 화상 포함)",
        "산부인과 응급 (OB-GYN emergency: 분만, 산과/부인과 통증)",
        "소아 응급 (Pediatric acute illness: 열, 경련, 탈수 등)"
      ],
      "mkiosk_flags": [
        "MKioskTy1",
        "MKioskTy10",
        "MKioskTy11",
        "MKioskTy15",
        "MKioskTy16",
        "MKioskTy17",
        "MKioskTy18",
        "MKioskTy2",
        "MKioskTy20",
        "MKioskTy22",
        "MKioskTy23",
        "MKioskTy26",
        "MKioskTy28",
        "MKioskTy3",
        "MKioskTy4",
        "MKioskTy5",
        "MKioskTy6",
        "MKioskTy7",
        "MKioskTy8",
        "MKioskTy9"
      ],
      "coverage_score": 0.4,
      "coverage_level": "LOW",
      "priority_score": 15.4,
      "reason_summary": "KTAS 2, 주증상 '호흡곤란 (Dyspnea / Respiratory distress)' 환자에 대해 뇌졸중 (재관류/중재), 소화기 내시경(출혈 포함) 기준 총 유효 병상 20개가 남아 있어 후보로 선정됨. (시술 커버리지: 필수 시술 중 일부만 가능, 약 40% 충족)"
    },
    {
      "id": "A1100054",
      "name": "성애의료재단성애병원",
      "address": "서울특별시 영등포구 여의대방로53길 22 (신길동, 성애병원)",
      "phone": "02-840-7114",
      "emergency_phone": "02-840-7115",
      "latitude": 37.51205044957338,
      "longitude": 126.92236733617031,
      "procedure_beds": {
        "ACS_MI": {
          "api_beds": 7,
          "effective_beds": 7
        },
        "ACS_STROKE": {
          "api_beds": 0,
          "effective_beds": 0
        },
        "AORTIC_EMERGENCY": {
          "api_beds": 7,
          "effective_beds": 7
        },
        "BRONCHOSCOPY": {
          "api_beds": 0,
          "effective_beds": 0
        },
        "GI_ENDOSCOPY": {
          "api_beds": 0,
          "effective_beds": 0
        }
      },
      "total_effective_beds": 20,
      "has_any_bed": true,
      "groups_with_beds": [
        "ACS_MI",
        "AORTIC_EMERGENCY"
      ],
      "groups_with_beds_labels": [
        "심근경색/ACS (응급 PCI)",
        "대동맥 응급(박리/파열)"
      ],
      "supported_complaints": [
        1,
        2,
        3,
        4,
        6,
        8
      ],
      "supported_complaint_labels": [
        "가슴 통증 (Chest pain)",
        "호흡곤란 (Dyspnea / Respiratory distress)",
        "신경학적 증상 (Stroke-like symptoms: 편마비, 말어눌함, 경련)",
        "복통 / 소화기 증상 (Abdominal pain / GI bleeding / vomiting)",
        "의식 변화 (Altered mental status / syncope)",
        "산부인과 응급 (OB-GYN emergency: 분만, 산과/부인과 통증)"
      ],
      "mkiosk_flags": [
        "MKioskTy1",
        "MKioskTy16",
        "MKioskTy17",
        "MKioskTy18",
        "MKioskTy28",
        "MKioskTy4",
        "MKioskTy7",
        "MKioskTy9"
      ],
      "coverage_score": 0.4,
      "coverage_level": "LOW",
      "priority_score": 15.4,
      "reason_summary": "KTAS 2, 주증상 '호흡곤란 (Dyspnea / Respiratory distress)' 환자에 대해 심근경색/ACS (응급 PCI), 대동맥 응급(박리/파열) 기준 총 유효 병상 20개가 남아 있어 후보로 선정됨. (시술 커버리지: 필수 시술 중 일부만 가능, 약 40% 충족)"
    },
    {
      "id": "A1100008",
      "name": "학교법인고려중앙학원고려대학교의과대학부속병원(안암병원)",
      "address": "서울특별시 성북구 고려대로 73, 고려대병원 (안암동5가)",
      "phone": "1577-0083",
      "emergency_phone": "02-920-5374",
      "latitude": 37.58715608002366,
      "longitude": 127.02647086385966,
      "procedure_beds": {
        "ACS_MI": {
          "api_beds": 0,
          "effective_beds": 0
        },
        "ACS_STROKE": {
          "api_beds": 0,
          "effective_beds": 0
        },
        "AORTIC_EMERGENCY": {
          "api_beds": 0,
          "effective_beds": 0
        },
        "BRONCHOSCOPY": {
          "api_beds": 0,
          "effective_beds": 0
        },
        "GI_ENDOSCOPY": {
          "api_beds": 20,
          "effective_beds": 20
        }
      },
      "total_effective_beds": 20,
      "has_any_bed": true,
      "groups_with_beds": [
        "GI_ENDOSCOPY"
      ],
      "groups_with_beds_labels": [
        "소화기 내시경(출혈 포함)"
      ],
      "supported_complaints": [
        1,
        2,
        3,
        4,
        5,
        6,
        7,
        8,
        9,
        10
      ],
      "supported_complaint_labels": [
        "가슴 통증 (Chest pain)",
        "호흡곤란 (Dyspnea / Respiratory distress)",
        "신경학적 증상 (Stroke-like symptoms: 편마비, 말어눌함, 경련)",
        "복통 / 소화기 증상 (Abdominal pain / GI bleeding / vomiting)",
        "출혈 (External bleeding / hematemesis / melena)",
        "의식 변화 (Altered mental status / syncope)",
        "외상 (Trauma: 교통사고, 낙상, 절단, 화상 포함)",
        "산부인과 응급 (OB-GYN emergency: 분만, 산과/부인과 통증)",
        "소아 응급 (Pediatric acute illness: 열, 경련, 탈수 등)",
        "정신과적 응급 (Psychiatric emergency: 자살위험, 폭력성, 급성정신병)"
      ],
      "mkiosk_flags": [
        "MKioskTy1",
        "MKioskTy10",
        "MKioskTy11",
        "MKioskTy15",
        "MKioskTy16",
        "MKioskTy17",
        "MKioskTy18",
        "MKioskTy2",
        "MKioskTy20",
        "MKioskTy21",
        "MKioskTy22",
        "MKioskTy23",
        "MKioskTy24",
        "MKioskTy25",
        "MKioskTy26",
        "MKioskTy27",
        "MKioskTy28",
        "MKioskTy3",
        "MKioskTy4",
        "MKioskTy5",
        "MKioskTy6",
        "MKioskTy7",
        "MKioskTy8",
        "MKioskTy9"
      ],
      "coverage_score": 0.2,
      "coverage_level": "LOW",
      "priority_score": 15,
      "reason_summary": "KTAS 2, 주증상 '호흡곤란 (Dyspnea / Respiratory distress)' 환자에 대해 소화기 내시경(출혈 포함) 기준 총 유효 병상 20개가 남아 있어 후보로 선정됨. (시술 커버리지: 필수 시술 중 일부만 가능, 약 20% 충족)"
    },
    {
      "id": "A1100055",
      "name": "한림대학교강남성심병원",
      "address": "서울특별시 영등포구 신길로 1 (대림동, 강남성심병원)",
      "phone": "02-829-5114",
      "emergency_phone": "02-829-5119",
      "latitude": 37.4932492859,
      "longitude": 126.9086725295,
      "procedure_beds": {
        "ACS_MI": {
          "api_beds": 0,
          "effective_beds": 0
        },
        "ACS_STROKE": {
          "api_beds": 0,
          "effective_beds": 0
        },
        "AORTIC_EMERGENCY": {
          "api_beds": 0,
          "effective_beds": 0
        },
        "BRONCHOSCOPY": {
          "api_beds": 0,
          "effective_beds": 0
        },
        "GI_ENDOSCOPY": {
          "api_beds": 19,
          "effective_beds": 19
        }
      },
      "total_effective_beds": 19,
      "has_any_bed": true,
      "groups_with_beds": [
        "GI_ENDOSCOPY"
      ],
      "groups_with_beds_labels": [
        "소화기 내시경(출혈 포함)"
      ],
      "supported_complaints": [
        1,
        2,
        3,
        4,
        5,
        6,
        7,
        8,
        9
      ],
      "supported_complaint_labels": [
        "가슴 통증 (Chest pain)",
        "호흡곤란 (Dyspnea / Respiratory distress)",
        "신경학적 증상 (Stroke-like symptoms: 편마비, 말어눌함, 경련)",
        "복통 / 소화기 증상 (Abdominal pain / GI bleeding / vomiting)",
        "출혈 (External bleeding / hematemesis / melena)",
        "의식 변화 (Altered mental status / syncope)",
        "외상 (Trauma: 교통사고, 낙상, 절단, 화상 포함)",
        "산부인과 응급 (OB-GYN emergency: 분만, 산과/부인과 통증)",
        "소아 응급 (Pediatric acute illness: 열, 경련, 탈수 등)"
      ],
      "mkiosk_flags": [
        "MKioskTy1",
        "MKioskTy11",
        "MKioskTy13",
        "MKioskTy15",
        "MKioskTy16",
        "MKioskTy17",
        "MKioskTy18",
        "MKioskTy19",
        "MKioskTy2",
        "MKioskTy20",
        "MKioskTy21",
        "MKioskTy22",
        "MKioskTy23",
        "MKioskTy25",
        "MKioskTy26",
        "MKioskTy28",
        "MKioskTy3",
        "MKioskTy4",
        "MKioskTy7",
        "MKioskTy8",
        "MKioskTy9"
      ],
      "coverage_score": 0.2,
      "coverage_level": "LOW",
      "priority_score": 14.2,
      "reason_summary": "KTAS 2, 주증상 '호흡곤란 (Dyspnea / Respiratory distress)' 환자에 대해 소화기 내시경(출혈 포함) 기준 총 유효 병상 19개가 남아 있어 후보로 선정됨. (시술 커버리지: 필수 시술 중 일부만 가능, 약 20% 충족)"
    },
    {
      "id": "A1100052",
      "name": "국립중앙의료원",
      "address": "서울특별시 중구 을지로 245, 국립중앙의료원 (을지로6가)",
      "phone": "02-2260-7114",
      "emergency_phone": "02-2276-2114",
      "latitude": 37.56733955813183,
      "longitude": 127.00579539705473,
      "procedure_beds": {
        "ACS_MI": {
          "api_beds": 5,
          "effective_beds": 5
        },
        "ACS_STROKE": {
          "api_beds": 0,
          "effective_beds": 0
        },
        "AORTIC_EMERGENCY": {
          "api_beds": 0,
          "effective_beds": 0
        },
        "BRONCHOSCOPY": {
          "api_beds": 0,
          "effective_beds": 0
        },
        "GI_ENDOSCOPY": {
          "api_beds": 0,
          "effective_beds": 0
        }
      },
      "total_effective_beds": 19,
      "has_any_bed": true,
      "groups_with_beds": [
        "ACS_MI"
      ],
      "groups_with_beds_labels": [
        "심근경색/ACS (응급 PCI)"
      ],
      "supported_complaints": [
        1,
        2,
        3,
        4,
        6,
        8
      ],
      "supported_complaint_labels": [
        "가슴 통증 (Chest pain)",
        "호흡곤란 (Dyspnea / Respiratory distress)",
        "신경학적 증상 (Stroke-like symptoms: 편마비, 말어눌함, 경련)",
        "복통 / 소화기 증상 (Abdominal pain / GI bleeding / vomiting)",
        "의식 변화 (Altered mental status / syncope)",
        "산부인과 응급 (OB-GYN emergency: 분만, 산과/부인과 통증)"
      ],
      "mkiosk_flags": [
        "MKioskTy1",
        "MKioskTy18",
        "MKioskTy23",
        "MKioskTy26",
        "MKioskTy28"
      ],
      "coverage_score": 0.2,
      "coverage_level": "LOW",
      "priority_score": 14.2,
      "reason_summary": "KTAS 2, 주증상 '호흡곤란 (Dyspnea / Respiratory distress)' 환자에 대해 심근경색/ACS (응급 PCI) 기준 총 유효 병상 19개가 남아 있어 후보로 선정됨. (시술 커버리지: 필수 시술 중 일부만 가능, 약 20% 충족)"
    },
    {
      "id": "A1100013",
      "name": "한양대학교병원",
      "address": "서울특별시 성동구 왕십리로 222-1 (사근동)",
      "phone": "02-2290-8114",
      "emergency_phone": "02-2290-8284",
      "latitude": 37.559944533564746,
      "longitude": 127.04488284061982,
      "procedure_beds": {
        "ACS_MI": {
          "api_beds": 1,
          "effective_beds": 1
        },
        "ACS_STROKE": {
          "api_beds": 0,
          "effective_beds": 0
        },
        "AORTIC_EMERGENCY": {
          "api_beds": 1,
          "effective_beds": 1
        },
        "BRONCHOSCOPY": {
          "api_beds": 0,
          "effective_beds": 0
        },
        "GI_ENDOSCOPY": {
          "api_beds": 15,
          "effective_beds": 15
        }
      },
      "total_effective_beds": 16,
      "has_any_bed": true,
      "groups_with_beds": [
        "ACS_MI",
        "AORTIC_EMERGENCY",
        "GI_ENDOSCOPY"
      ],
      "groups_with_beds_labels": [
        "심근경색/ACS (응급 PCI)",
        "대동맥 응급(박리/파열)",
        "소화기 내시경(출혈 포함)"
      ],
      "supported_complaints": [
        1,
        2,
        3,
        4,
        5,
        6,
        7,
        8,
        9
      ],
      "supported_complaint_labels": [
        "가슴 통증 (Chest pain)",
        "호흡곤란 (Dyspnea / Respiratory distress)",
        "신경학적 증상 (Stroke-like symptoms: 편마비, 말어눌함, 경련)",
        "복통 / 소화기 증상 (Abdominal pain / GI bleeding / vomiting)",
        "출혈 (External bleeding / hematemesis / melena)",
        "의식 변화 (Altered mental status / syncope)",
        "외상 (Trauma: 교통사고, 낙상, 절단, 화상 포함)",
        "산부인과 응급 (OB-GYN emergency: 분만, 산과/부인과 통증)",
        "소아 응급 (Pediatric acute illness: 열, 경련, 탈수 등)"
      ],
      "mkiosk_flags": [
        "MKioskTy1",
        "MKioskTy10",
        "MKioskTy11",
        "MKioskTy15",
        "MKioskTy16",
        "MKioskTy17",
        "MKioskTy18",
        "MKioskTy2",
        "MKioskTy20",
        "MKioskTy21",
        "MKioskTy22",
        "MKioskTy23",
        "MKioskTy25",
        "MKioskTy26",
        "MKioskTy28",
        "MKioskTy3",
        "MKioskTy4",
        "MKioskTy5",
        "MKioskTy6",
        "MKioskTy7",
        "MKioskTy8",
        "MKioskTy9"
      ],
      "coverage_score": 0.6,
      "coverage_level": "MEDIUM",
      "priority_score": 14.2,
      "reason_summary": "KTAS 2, 주증상 '호흡곤란 (Dyspnea / Respiratory distress)' 환자에 대해 심근경색/ACS (응급 PCI), 대동맥 응급(박리/파열), 소화기 내시경(출혈 포함) 기준 총 유효 병상 16개가 남아 있어 후보로 선정됨. (시술 커버리지: 일부 핵심 시술만 가능, 약 60% 충족)"
    },
    {
      "id": "A1100006",
      "name": "강북삼성병원",
      "address": "서울특별시 종로구 새문안로 29 (평동)",
      "phone": "02-2001-2001",
      "emergency_phone": "02-2001-1000",
      "latitude": 37.568497631233825,
      "longitude": 126.96793805451702,
      "procedure_beds": {
        "ACS_MI": {
          "api_beds": 6,
          "effective_beds": 6
        },
        "ACS_STROKE": {
          "api_beds": 0,
          "effective_beds": 0
        },
        "AORTIC_EMERGENCY": {
          "api_beds": 6,
          "effective_beds": 6
        },
        "BRONCHOSCOPY": {
          "api_beds": 0,
          "effective_beds": 0
        },
        "GI_ENDOSCOPY": {
          "api_beds": 10,
          "effective_beds": 10
        }
      },
      "total_effective_beds": 16,
      "has_any_bed": true,
      "groups_with_beds": [
        "ACS_MI",
        "AORTIC_EMERGENCY",
        "GI_ENDOSCOPY"
      ],
      "groups_with_beds_labels": [
        "심근경색/ACS (응급 PCI)",
        "대동맥 응급(박리/파열)",
        "소화기 내시경(출혈 포함)"
      ],
      "supported_complaints": [
        1,
        2,
        3,
        4,
        5,
        6,
        8,
        9
      ],
      "supported_complaint_labels": [
        "가슴 통증 (Chest pain)",
        "호흡곤란 (Dyspnea / Respiratory distress)",
        "신경학적 증상 (Stroke-like symptoms: 편마비, 말어눌함, 경련)",
        "복통 / 소화기 증상 (Abdominal pain / GI bleeding / vomiting)",
        "출혈 (External bleeding / hematemesis / melena)",
        "의식 변화 (Altered mental status / syncope)",
        "산부인과 응급 (OB-GYN emergency: 분만, 산과/부인과 통증)",
        "소아 응급 (Pediatric acute illness: 열, 경련, 탈수 등)"
      ],
      "mkiosk_flags": [
        "MKioskTy1",
        "MKioskTy11",
        "MKioskTy12",
        "MKioskTy15",
        "MKioskTy16",
        "MKioskTy17",
        "MKioskTy18",
        "MKioskTy2",
        "MKioskTy22",
        "MKioskTy23",
        "MKioskTy26",
        "MKioskTy28",
        "MKioskTy3",
        "MKioskTy4",
        "MKioskTy5",
        "MKioskTy6",
        "MKioskTy7",
        "MKioskTy8",
        "MKioskTy9"
      ],
      "coverage_score": 0.6,
      "coverage_level": "MEDIUM",
      "priority_score": 14.2,
      "reason_summary": "KTAS 2, 주증상 '호흡곤란 (Dyspnea / Respiratory distress)' 환자에 대해 심근경색/ACS (응급 PCI), 대동맥 응급(박리/파열), 소화기 내시경(출혈 포함) 기준 총 유효 병상 16개가 남아 있어 후보로 선정됨. (시술 커버리지: 일부 핵심 시술만 가능, 약 60% 충족)"
    },
    {
      "id": "A1100028",
      "name": "성심의료재단강동성심병원",
      "address": "서울특별시 강동구 성안로 150 (길동)",
      "phone": "02-2224-2114",
      "emergency_phone": "02-2224-2358",
      "latitude": 37.53598408220376,
      "longitude": 127.13526354631517,
      "procedure_beds": {
        "ACS_MI": {
          "api_beds": 4,
          "effective_beds": 4
        },
        "ACS_STROKE": {
          "api_beds": 0,
          "effective_beds": 0
        },
        "AORTIC_EMERGENCY": {
          "api_beds": 4,
          "effective_beds": 4
        },
        "BRONCHOSCOPY": {
          "api_beds": 0,
          "effective_beds": 0
        },
        "GI_ENDOSCOPY": {
          "api_beds": 11,
          "effective_beds": 11
        }
      },
      "total_effective_beds": 15,
      "has_any_bed": true,
      "groups_with_beds": [
        "ACS_MI",
        "AORTIC_EMERGENCY",
        "GI_ENDOSCOPY"
      ],
      "groups_with_beds_labels": [
        "심근경색/ACS (응급 PCI)",
        "대동맥 응급(박리/파열)",
        "소화기 내시경(출혈 포함)"
      ],
      "supported_complaints": [
        1,
        2,
        3,
        4,
        5,
        6,
        7
      ],
      "supported_complaint_labels": [
        "가슴 통증 (Chest pain)",
        "호흡곤란 (Dyspnea / Respiratory distress)",
        "신경학적 증상 (Stroke-like symptoms: 편마비, 말어눌함, 경련)",
        "복통 / 소화기 증상 (Abdominal pain / GI bleeding / vomiting)",
        "출혈 (External bleeding / hematemesis / melena)",
        "의식 변화 (Altered mental status / syncope)",
        "외상 (Trauma: 교통사고, 낙상, 절단, 화상 포함)"
      ],
      "mkiosk_flags": [
        "MKioskTy1",
        "MKioskTy11",
        "MKioskTy2",
        "MKioskTy20",
        "MKioskTy21",
        "MKioskTy22",
        "MKioskTy23",
        "MKioskTy25",
        "MKioskTy26",
        "MKioskTy28",
        "MKioskTy3",
        "MKioskTy4",
        "MKioskTy5",
        "MKioskTy6",
        "MKioskTy7",
        "MKioskTy8",
        "MKioskTy9"
      ],
      "coverage_score": 0.6,
      "coverage_level": "MEDIUM",
      "priority_score": 13.3,
      "reason_summary": "KTAS 2, 주증상 '호흡곤란 (Dyspnea / Respiratory distress)' 환자에 대해 심근경색/ACS (응급 PCI), 대동맥 응급(박리/파열), 소화기 내시경(출혈 포함) 기준 총 유효 병상 15개가 남아 있어 후보로 선정됨. (시술 커버리지: 일부 핵심 시술만 가능, 약 60% 충족)"
    },
    {
      "id": "A1100003",
      "name": "중앙대학교병원",
      "address": "서울특별시 동작구 흑석로 102 (흑석동)",
      "phone": "1800-1114",
      "emergency_phone": "02-6299-1338",
      "latitude": 37.50707428493414,
      "longitude": 126.96079378447554,
      "procedure_beds": {
        "ACS_MI": {
          "api_beds": 7,
          "effective_beds": 7
        },
        "ACS_STROKE": {
          "api_beds": 0,
          "effective_beds": 0
        },
        "AORTIC_EMERGENCY": {
          "api_beds": 7,
          "effective_beds": 7
        },
        "BRONCHOSCOPY": {
          "api_beds": 0,
          "effective_beds": 0
        },
        "GI_ENDOSCOPY": {
          "api_beds": 8,
          "effective_beds": 8
        }
      },
      "total_effective_beds": 15,
      "has_any_bed": true,
      "groups_with_beds": [
        "ACS_MI",
        "AORTIC_EMERGENCY",
        "GI_ENDOSCOPY"
      ],
      "groups_with_beds_labels": [
        "심근경색/ACS (응급 PCI)",
        "대동맥 응급(박리/파열)",
        "소화기 내시경(출혈 포함)"
      ],
      "supported_complaints": [
        1,
        2,
        3,
        4,
        5,
        6,
        8,
        9
      ],
      "supported_complaint_labels": [
        "가슴 통증 (Chest pain)",
        "호흡곤란 (Dyspnea / Respiratory distress)",
        "신경학적 증상 (Stroke-like symptoms: 편마비, 말어눌함, 경련)",
        "복통 / 소화기 증상 (Abdominal pain / GI bleeding / vomiting)",
        "출혈 (External bleeding / hematemesis / melena)",
        "의식 변화 (Altered mental status / syncope)",
        "산부인과 응급 (OB-GYN emergency: 분만, 산과/부인과 통증)",
        "소아 응급 (Pediatric acute illness: 열, 경련, 탈수 등)"
      ],
      "mkiosk_flags": [
        "MKioskTy1",
        "MKioskTy11",
        "MKioskTy15",
        "MKioskTy16",
        "MKioskTy17",
        "MKioskTy18",
        "MKioskTy2",
        "MKioskTy22",
        "MKioskTy23",
        "MKioskTy26",
        "MKioskTy28",
        "MKioskTy3",
        "MKioskTy4",
        "MKioskTy7",
        "MKioskTy8",
        "MKioskTy9"
      ],
      "coverage_score": 0.6,
      "coverage_level": "MEDIUM",
      "priority_score": 13.3,
      "reason_summary": "KTAS 2, 주증상 '호흡곤란 (Dyspnea / Respiratory distress)' 환자에 대해 심근경색/ACS (응급 PCI), 대동맥 응급(박리/파열), 소화기 내시경(출혈 포함) 기준 총 유효 병상 15개가 남아 있어 후보로 선정됨. (시술 커버리지: 일부 핵심 시술만 가능, 약 60% 충족)"
    },
    {
      "id": "A1100019",
      "name": "홍익병원",
      "address": "서울특별시 양천구 목동로 225, 홍익병원본관 (신정동)",
      "phone": "02-2693-5555",
      "emergency_phone": "02-2600-0777",
      "latitude": 37.52844147447355,
      "longitude": 126.8636640030062,
      "procedure_beds": {
        "ACS_MI": {
          "api_beds": 6,
          "effective_beds": 6
        },
        "ACS_STROKE": {
          "api_beds": 0,
          "effective_beds": 0
        },
        "AORTIC_EMERGENCY": {
          "api_beds": 6,
          "effective_beds": 6
        },
        "BRONCHOSCOPY": {
          "api_beds": 0,
          "effective_beds": 0
        },
        "GI_ENDOSCOPY": {
          "api_beds": 0,
          "effective_beds": 0
        }
      },
      "total_effective_beds": 15,
      "has_any_bed": true,
      "groups_with_beds": [
        "ACS_MI",
        "AORTIC_EMERGENCY"
      ],
      "groups_with_beds_labels": [
        "심근경색/ACS (응급 PCI)",
        "대동맥 응급(박리/파열)"
      ],
      "supported_complaints": [
        1,
        2,
        3,
        6
      ],
      "supported_complaint_labels": [
        "가슴 통증 (Chest pain)",
        "호흡곤란 (Dyspnea / Respiratory distress)",
        "신경학적 증상 (Stroke-like symptoms: 편마비, 말어눌함, 경련)",
        "의식 변화 (Altered mental status / syncope)"
      ],
      "mkiosk_flags": [
        "MKioskTy1",
        "MKioskTy2",
        "MKioskTy28",
        "MKioskTy3",
        "MKioskTy4"
      ],
      "coverage_score": 0.4,
      "coverage_level": "LOW",
      "priority_score": 11.6,
      "reason_summary": "KTAS 2, 주증상 '호흡곤란 (Dyspnea / Respiratory distress)' 환자에 대해 심근경색/ACS (응급 PCI), 대동맥 응급(박리/파열) 기준 총 유효 병상 15개가 남아 있어 후보로 선정됨. (시술 커버리지: 필수 시술 중 일부만 가능, 약 40% 충족)"
    },
    {
      "id": "A1100053",
      "name": "한국보훈복지의료공단중앙보훈병원",
      "address": "서울특별시 강동구 진황도로61길 53 (둔촌동)",
      "phone": "02-2225-1111",
      "emergency_phone": "02-2225-1100",
      "latitude": 37.528220900896635,
      "longitude": 127.14671886173552,
      "procedure_beds": {
        "ACS_MI": {
          "api_beds": 0,
          "effective_beds": 0
        },
        "ACS_STROKE": {
          "api_beds": 0,
          "effective_beds": 0
        },
        "AORTIC_EMERGENCY": {
          "api_beds": 0,
          "effective_beds": 0
        },
        "BRONCHOSCOPY": {
          "api_beds": 0,
          "effective_beds": 0
        },
        "GI_ENDOSCOPY": {
          "api_beds": 15,
          "effective_beds": 15
        }
      },
      "total_effective_beds": 15,
      "has_any_bed": true,
      "groups_with_beds": [
        "GI_ENDOSCOPY"
      ],
      "groups_with_beds_labels": [
        "소화기 내시경(출혈 포함)"
      ],
      "supported_complaints": [
        1,
        2,
        3,
        4,
        5,
        6,
        7
      ],
      "supported_complaint_labels": [
        "가슴 통증 (Chest pain)",
        "호흡곤란 (Dyspnea / Respiratory distress)",
        "신경학적 증상 (Stroke-like symptoms: 편마비, 말어눌함, 경련)",
        "복통 / 소화기 증상 (Abdominal pain / GI bleeding / vomiting)",
        "출혈 (External bleeding / hematemesis / melena)",
        "의식 변화 (Altered mental status / syncope)",
        "외상 (Trauma: 교통사고, 낙상, 절단, 화상 포함)"
      ],
      "mkiosk_flags": [
        "MKioskTy11",
        "MKioskTy25",
        "MKioskTy3",
        "MKioskTy4",
        "MKioskTy9"
      ],
      "coverage_score": 0.2,
      "coverage_level": "LOW",
      "priority_score": 11.2,
      "reason_summary": "KTAS 2, 주증상 '호흡곤란 (Dyspnea / Respiratory distress)' 환자에 대해 소화기 내시경(출혈 포함) 기준 총 유효 병상 15개가 남아 있어 후보로 선정됨. (시술 커버리지: 필수 시술 중 일부만 가능, 약 20% 충족)"
    },
    {
      "id": "A1100002",
      "name": "건국대학교병원",
      "address": "서울특별시 광진구 능동로 120-1 (화양동)",
      "phone": "1588-1533",
      "emergency_phone": "02-2030-5555",
      "latitude": 37.54084479467721,
      "longitude": 127.0721229093036,
      "procedure_beds": {
        "ACS_MI": {
          "api_beds": 0,
          "effective_beds": 0
        },
        "ACS_STROKE": {
          "api_beds": 0,
          "effective_beds": 0
        },
        "AORTIC_EMERGENCY": {
          "api_beds": 0,
          "effective_beds": 0
        },
        "BRONCHOSCOPY": {
          "api_beds": 0,
          "effective_beds": 0
        },
        "GI_ENDOSCOPY": {
          "api_beds": 14,
          "effective_beds": 14
        }
      },
      "total_effective_beds": 14,
      "has_any_bed": true,
      "groups_with_beds": [
        "GI_ENDOSCOPY"
      ],
      "groups_with_beds_labels": [
        "소화기 내시경(출혈 포함)"
      ],
      "supported_complaints": [
        1,
        2,
        3,
        4,
        5,
        6,
        7,
        8,
        9
      ],
      "supported_complaint_labels": [
        "가슴 통증 (Chest pain)",
        "호흡곤란 (Dyspnea / Respiratory distress)",
        "신경학적 증상 (Stroke-like symptoms: 편마비, 말어눌함, 경련)",
        "복통 / 소화기 증상 (Abdominal pain / GI bleeding / vomiting)",
        "출혈 (External bleeding / hematemesis / melena)",
        "의식 변화 (Altered mental status / syncope)",
        "외상 (Trauma: 교통사고, 낙상, 절단, 화상 포함)",
        "산부인과 응급 (OB-GYN emergency: 분만, 산과/부인과 통증)",
        "소아 응급 (Pediatric acute illness: 열, 경련, 탈수 등)"
      ],
      "mkiosk_flags": [
        "MKioskTy1",
        "MKioskTy11",
        "MKioskTy12",
        "MKioskTy13",
        "MKioskTy15",
        "MKioskTy16",
        "MKioskTy17",
        "MKioskTy18",
        "MKioskTy22",
        "MKioskTy23",
        "MKioskTy25",
        "MKioskTy26",
        "MKioskTy28",
        "MKioskTy3",
        "MKioskTy4",
        "MKioskTy7",
        "MKioskTy8",
        "MKioskTy9"
      ],
      "coverage_score": 0.2,
      "coverage_level": "LOW",
      "priority_score": 10.5,
      "reason_summary": "KTAS 2, 주증상 '호흡곤란 (Dyspnea / Respiratory distress)' 환자에 대해 소화기 내시경(출혈 포함) 기준 총 유효 병상 14개가 남아 있어 후보로 선정됨. (시술 커버리지: 필수 시술 중 일부만 가능, 약 20% 충족)"
    },
    {
      "id": "A1100048",
      "name": "노원을지대학교병원",
      "address": "서울특별시 노원구 한글비석로 68, 을지병원 (하계동)",
      "phone": "02-970-8000",
      "emergency_phone": "02-970-8282",
      "latitude": 37.636442927386746,
      "longitude": 127.07000281991385,
      "procedure_beds": {
        "ACS_MI": {
          "api_beds": 0,
          "effective_beds": 0
        },
        "ACS_STROKE": {
          "api_beds": 0,
          "effective_beds": 0
        },
        "AORTIC_EMERGENCY": {
          "api_beds": 0,
          "effective_beds": 0
        },
        "BRONCHOSCOPY": {
          "api_beds": 0,
          "effective_beds": 0
        },
        "GI_ENDOSCOPY": {
          "api_beds": 14,
          "effective_beds": 14
        }
      },
      "total_effective_beds": 14,
      "has_any_bed": true,
      "groups_with_beds": [
        "GI_ENDOSCOPY"
      ],
      "groups_with_beds_labels": [
        "소화기 내시경(출혈 포함)"
      ],
      "supported_complaints": [
        1,
        2,
        3,
        4,
        5,
        6,
        9
      ],
      "supported_complaint_labels": [
        "가슴 통증 (Chest pain)",
        "호흡곤란 (Dyspnea / Respiratory distress)",
        "신경학적 증상 (Stroke-like symptoms: 편마비, 말어눌함, 경련)",
        "복통 / 소화기 증상 (Abdominal pain / GI bleeding / vomiting)",
        "출혈 (External bleeding / hematemesis / melena)",
        "의식 변화 (Altered mental status / syncope)",
        "소아 응급 (Pediatric acute illness: 열, 경련, 탈수 등)"
      ],
      "mkiosk_flags": [
        "MKioskTy10",
        "MKioskTy11",
        "MKioskTy2",
        "MKioskTy3",
        "MKioskTy4",
        "MKioskTy7",
        "MKioskTy8",
        "MKioskTy9"
      ],
      "coverage_score": 0.2,
      "coverage_level": "LOW",
      "priority_score": 10.5,
      "reason_summary": "KTAS 2, 주증상 '호흡곤란 (Dyspnea / Respiratory distress)' 환자에 대해 소화기 내시경(출혈 포함) 기준 총 유효 병상 14개가 남아 있어 후보로 선정됨. (시술 커버리지: 필수 시술 중 일부만 가능, 약 20% 충족)"
    },
    {
      "id": "A1100021",
      "name": "삼육서울병원",
      "address": "서울특별시 동대문구 망우로 82 (휘경동)",
      "phone": "02-2244-0191",
      "emergency_phone": "02-2210-3566",
      "latitude": 37.587992001305395,
      "longitude": 127.0653288266823,
      "procedure_beds": {
        "ACS_MI": {
          "api_beds": 4,
          "effective_beds": 4
        },
        "ACS_STROKE": {
          "api_beds": 0,
          "effective_beds": 0
        },
        "AORTIC_EMERGENCY": {
          "api_beds": 0,
          "effective_beds": 0
        },
        "BRONCHOSCOPY": {
          "api_beds": 0,
          "effective_beds": 0
        },
        "GI_ENDOSCOPY": {
          "api_beds": 9,
          "effective_beds": 9
        }
      },
      "total_effective_beds": 13,
      "has_any_bed": true,
      "groups_with_beds": [
        "ACS_MI",
        "GI_ENDOSCOPY"
      ],
      "groups_with_beds_labels": [
        "심근경색/ACS (응급 PCI)",
        "소화기 내시경(출혈 포함)"
      ],
      "supported_complaints": [
        1,
        2,
        3,
        4,
        5,
        6,
        8
      ],
      "supported_complaint_labels": [
        "가슴 통증 (Chest pain)",
        "호흡곤란 (Dyspnea / Respiratory distress)",
        "신경학적 증상 (Stroke-like symptoms: 편마비, 말어눌함, 경련)",
        "복통 / 소화기 증상 (Abdominal pain / GI bleeding / vomiting)",
        "출혈 (External bleeding / hematemesis / melena)",
        "의식 변화 (Altered mental status / syncope)",
        "산부인과 응급 (OB-GYN emergency: 분만, 산과/부인과 통증)"
      ],
      "mkiosk_flags": [
        "MKioskTy1",
        "MKioskTy11",
        "MKioskTy16",
        "MKioskTy17",
        "MKioskTy23",
        "MKioskTy28",
        "MKioskTy9"
      ],
      "coverage_score": 0.4,
      "coverage_level": "LOW",
      "priority_score": 10,
      "reason_summary": "KTAS 2, 주증상 '호흡곤란 (Dyspnea / Respiratory distress)' 환자에 대해 심근경색/ACS (응급 PCI), 소화기 내시경(출혈 포함) 기준 총 유효 병상 13개가 남아 있어 후보로 선정됨. (시술 커버리지: 필수 시술 중 일부만 가능, 약 40% 충족)"
    },
    {
      "id": "A1100041",
      "name": "의료법인서울효천의료재단에이치플러스양지병원",
      "address": "서울특별시 관악구 남부순환로 1636, 양지병원 (신림동)",
      "phone": "02-1877-8875",
      "emergency_phone": "070-4665-9119",
      "latitude": 37.48427507045319,
      "longitude": 126.93253922577287,
      "procedure_beds": {
        "ACS_MI": {
          "api_beds": 0,
          "effective_beds": 0
        },
        "ACS_STROKE": {
          "api_beds": 0,
          "effective_beds": 0
        },
        "AORTIC_EMERGENCY": {
          "api_beds": 0,
          "effective_beds": 0
        },
        "BRONCHOSCOPY": {
          "api_beds": 0,
          "effective_beds": 0
        },
        "GI_ENDOSCOPY": {
          "api_beds": 12,
          "effective_beds": 12
        }
      },
      "total_effective_beds": 12,
      "has_any_bed": true,
      "groups_with_beds": [
        "GI_ENDOSCOPY"
      ],
      "groups_with_beds_labels": [
        "소화기 내시경(출혈 포함)"
      ],
      "supported_complaints": [
        1,
        2,
        3,
        4,
        5,
        6,
        8
      ],
      "supported_complaint_labels": [
        "가슴 통증 (Chest pain)",
        "호흡곤란 (Dyspnea / Respiratory distress)",
        "신경학적 증상 (Stroke-like symptoms: 편마비, 말어눌함, 경련)",
        "복통 / 소화기 증상 (Abdominal pain / GI bleeding / vomiting)",
        "출혈 (External bleeding / hematemesis / melena)",
        "의식 변화 (Altered mental status / syncope)",
        "산부인과 응급 (OB-GYN emergency: 분만, 산과/부인과 통증)"
      ],
      "mkiosk_flags": [
        "MKioskTy1",
        "MKioskTy11",
        "MKioskTy18",
        "MKioskTy2",
        "MKioskTy22",
        "MKioskTy23",
        "MKioskTy26",
        "MKioskTy28",
        "MKioskTy3",
        "MKioskTy4",
        "MKioskTy7",
        "MKioskTy8",
        "MKioskTy9"
      ],
      "coverage_score": 0.2,
      "coverage_level": "LOW",
      "priority_score": 9,
      "reason_summary": "KTAS 2, 주증상 '호흡곤란 (Dyspnea / Respiratory distress)' 환자에 대해 소화기 내시경(출혈 포함) 기준 총 유효 병상 12개가 남아 있어 후보로 선정됨. (시술 커버리지: 필수 시술 중 일부만 가능, 약 20% 충족)"
    },
    {
      "id": "A1100049",
      "name": "희명병원",
      "address": "서울특별시 금천구 시흥대로 244 (시흥동)",
      "phone": "02-804-0002",
      "emergency_phone": "02-809-0122",
      "latitude": 37.45567063464179,
      "longitude": 126.90056251863875,
      "procedure_beds": {
        "ACS_MI": {
          "api_beds": 1,
          "effective_beds": 1
        },
        "ACS_STROKE": {
          "api_beds": 0,
          "effective_beds": 0
        },
        "AORTIC_EMERGENCY": {
          "api_beds": 0,
          "effective_beds": 0
        },
        "BRONCHOSCOPY": {
          "api_beds": 0,
          "effective_beds": 0
        },
        "GI_ENDOSCOPY": {
          "api_beds": 0,
          "effective_beds": 0
        }
      },
      "total_effective_beds": 10,
      "has_any_bed": true,
      "groups_with_beds": [
        "ACS_MI"
      ],
      "groups_with_beds_labels": [
        "심근경색/ACS (응급 PCI)"
      ],
      "supported_complaints": [
        1,
        2,
        3,
        4,
        6,
        7
      ],
      "supported_complaint_labels": [
        "가슴 통증 (Chest pain)",
        "호흡곤란 (Dyspnea / Respiratory distress)",
        "신경학적 증상 (Stroke-like symptoms: 편마비, 말어눌함, 경련)",
        "복통 / 소화기 증상 (Abdominal pain / GI bleeding / vomiting)",
        "의식 변화 (Altered mental status / syncope)",
        "외상 (Trauma: 교통사고, 낙상, 절단, 화상 포함)"
      ],
      "mkiosk_flags": [
        "MKioskTy1",
        "MKioskTy20",
        "MKioskTy21",
        "MKioskTy22",
        "MKioskTy23",
        "MKioskTy26",
        "MKioskTy28",
        "MKioskTy7",
        "MKioskTy8",
        "MKioskTy9"
      ],
      "coverage_score": 0.2,
      "coverage_level": "LOW",
      "priority_score": 7.5,
      "reason_summary": "KTAS 2, 주증상 '호흡곤란 (Dyspnea / Respiratory distress)' 환자에 대해 심근경색/ACS (응급 PCI) 기준 총 유효 병상 10개가 남아 있어 후보로 선정됨. (시술 커버리지: 필수 시술 중 일부만 가능, 약 20% 충족)"
    },
    {
      "id": "A1100024",
      "name": "명지성모병원",
      "address": "서울특별시 영등포구 도림로 156, 명지성모병원 (대림동)",
      "phone": "02-1899-1475",
      "emergency_phone": "02-829-7800",
      "latitude": 37.4938507104387,
      "longitude": 126.89925446922592,
      "procedure_beds": {
        "ACS_MI": {
          "api_beds": 0,
          "effective_beds": 0
        },
        "ACS_STROKE": {
          "api_beds": 0,
          "effective_beds": 0
        },
        "AORTIC_EMERGENCY": {
          "api_beds": 2,
          "effective_beds": 2
        },
        "BRONCHOSCOPY": {
          "api_beds": 0,
          "effective_beds": 0
        },
        "GI_ENDOSCOPY": {
          "api_beds": 0,
          "effective_beds": 0
        }
      },
      "total_effective_beds": 10,
      "has_any_bed": true,
      "groups_with_beds": [
        "AORTIC_EMERGENCY"
      ],
      "groups_with_beds_labels": [
        "대동맥 응급(박리/파열)"
      ],
      "supported_complaints": [
        1,
        2,
        3,
        6
      ],
      "supported_complaint_labels": [
        "가슴 통증 (Chest pain)",
        "호흡곤란 (Dyspnea / Respiratory distress)",
        "신경학적 증상 (Stroke-like symptoms: 편마비, 말어눌함, 경련)",
        "의식 변화 (Altered mental status / syncope)"
      ],
      "mkiosk_flags": [
        "MKioskTy2",
        "MKioskTy3",
        "MKioskTy4"
      ],
      "coverage_score": 0.2,
      "coverage_level": "LOW",
      "priority_score": 7.5,
      "reason_summary": "KTAS 2, 주증상 '호흡곤란 (Dyspnea / Respiratory distress)' 환자에 대해 대동맥 응급(박리/파열) 기준 총 유효 병상 10개가 남아 있어 후보로 선정됨. (시술 커버리지: 필수 시술 중 일부만 가능, 약 20% 충족)"
    },
    {
      "id": "A1100044",
      "name": "녹색병원",
      "address": "서울특별시 중랑구 사가정로49길 53 (면목동)",
      "phone": "02-490-2000",
      "emergency_phone": "02-490-2113",
      "latitude": 37.58362083896108,
      "longitude": 127.08605546969358,
      "procedure_beds": {
        "ACS_MI": {
          "api_beds": 0,
          "effective_beds": 0
        },
        "ACS_STROKE": {
          "api_beds": 0,
          "effective_beds": 0
        },
        "AORTIC_EMERGENCY": {
          "api_beds": 1,
          "effective_beds": 1
        },
        "BRONCHOSCOPY": {
          "api_beds": 0,
          "effective_beds": 0
        },
        "GI_ENDOSCOPY": {
          "api_beds": 1,
          "effective_beds": 1
        }
      },
      "total_effective_beds": 7,
      "has_any_bed": true,
      "groups_with_beds": [
        "AORTIC_EMERGENCY",
        "GI_ENDOSCOPY"
      ],
      "groups_with_beds_labels": [
        "대동맥 응급(박리/파열)",
        "소화기 내시경(출혈 포함)"
      ],
      "supported_complaints": [
        1,
        2,
        3,
        4,
        5,
        6
      ],
      "supported_complaint_labels": [
        "가슴 통증 (Chest pain)",
        "호흡곤란 (Dyspnea / Respiratory distress)",
        "신경학적 증상 (Stroke-like symptoms: 편마비, 말어눌함, 경련)",
        "복통 / 소화기 증상 (Abdominal pain / GI bleeding / vomiting)",
        "출혈 (External bleeding / hematemesis / melena)",
        "의식 변화 (Altered mental status / syncope)"
      ],
      "mkiosk_flags": [
        "MKioskTy11",
        "MKioskTy4",
        "MKioskTy7",
        "MKioskTy9"
      ],
      "coverage_score": 0.4,
      "coverage_level": "LOW",
      "priority_score": 5.4,
      "reason_summary": "KTAS 2, 주증상 '호흡곤란 (Dyspnea / Respiratory distress)' 환자에 대해 대동맥 응급(박리/파열), 소화기 내시경(출혈 포함) 기준 총 유효 병상 7개가 남아 있어 후보로 선정됨. (시술 커버리지: 필수 시술 중 일부만 가능, 약 40% 충족)"
    },
    {
      "id": "A1100016",
      "name": "인제대학교상계백병원",
      "address": "서울특별시 노원구 동일로 1342, 상계백병원 (상계동)",
      "phone": "02-950-1114",
      "emergency_phone": "02-950-1119",
      "latitude": 37.6485812672986,
      "longitude": 127.06311619032103,
      "procedure_beds": {
        "ACS_MI": {
          "api_beds": 0,
          "effective_beds": 0
        },
        "ACS_STROKE": {
          "api_beds": 0,
          "effective_beds": 0
        },
        "AORTIC_EMERGENCY": {
          "api_beds": 0,
          "effective_beds": 0
        },
        "BRONCHOSCOPY": {
          "api_beds": 0,
          "effective_beds": 0
        },
        "GI_ENDOSCOPY": {
          "api_beds": 6,
          "effective_beds": 6
        }
      },
      "total_effective_beds": 6,
      "has_any_bed": true,
      "groups_with_beds": [
        "GI_ENDOSCOPY"
      ],
      "groups_with_beds_labels": [
        "소화기 내시경(출혈 포함)"
      ],
      "supported_complaints": [
        1,
        2,
        3,
        4,
        5,
        6
      ],
      "supported_complaint_labels": [
        "가슴 통증 (Chest pain)",
        "호흡곤란 (Dyspnea / Respiratory distress)",
        "신경학적 증상 (Stroke-like symptoms: 편마비, 말어눌함, 경련)",
        "복통 / 소화기 증상 (Abdominal pain / GI bleeding / vomiting)",
        "출혈 (External bleeding / hematemesis / melena)",
        "의식 변화 (Altered mental status / syncope)"
      ],
      "mkiosk_flags": [
        "MKioskTy11",
        "MKioskTy2",
        "MKioskTy3",
        "MKioskTy4",
        "MKioskTy5",
        "MKioskTy6",
        "MKioskTy7",
        "MKioskTy9"
      ],
      "coverage_score": 0.2,
      "coverage_level": "LOW",
      "priority_score": 4.5,
      "reason_summary": "KTAS 2, 주증상 '호흡곤란 (Dyspnea / Respiratory distress)' 환자에 대해 소화기 내시경(출혈 포함) 기준 총 유효 병상 6개가 남아 있어 후보로 선정됨. (시술 커버리지: 필수 시술 중 일부만 가능, 약 20% 충족)"
    },
    {
      "id": "A1100012",
      "name": "학교법인가톨릭학원가톨릭대학교서울성모병원",
      "address": "서울특별시 서초구 반포대로 222 (반포동)",
      "phone": "0215881511",
      "emergency_phone": "02-2258-2370",
      "latitude": 37.501800804785276,
      "longitude": 127.00472725970137,
      "procedure_beds": {
        "ACS_MI": {
          "api_beds": 0,
          "effective_beds": 0
        },
        "ACS_STROKE": {
          "api_beds": 0,
          "effective_beds": 0
        },
        "AORTIC_EMERGENCY": {
          "api_beds": 0,
          "effective_beds": 0
        },
        "BRONCHOSCOPY": {
          "api_beds": 0,
          "effective_beds": 0
        },
        "GI_ENDOSCOPY": {
          "api_beds": 6,
          "effective_beds": 6
        }
      },
      "total_effective_beds": 6,
      "has_any_bed": true,
      "groups_with_beds": [
        "GI_ENDOSCOPY"
      ],
      "groups_with_beds_labels": [
        "소화기 내시경(출혈 포함)"
      ],
      "supported_complaints": [
        1,
        2,
        3,
        4,
        5,
        6,
        7,
        8,
        9,
        10
      ],
      "supported_complaint_labels": [
        "가슴 통증 (Chest pain)",
        "호흡곤란 (Dyspnea / Respiratory distress)",
        "신경학적 증상 (Stroke-like symptoms: 편마비, 말어눌함, 경련)",
        "복통 / 소화기 증상 (Abdominal pain / GI bleeding / vomiting)",
        "출혈 (External bleeding / hematemesis / melena)",
        "의식 변화 (Altered mental status / syncope)",
        "외상 (Trauma: 교통사고, 낙상, 절단, 화상 포함)",
        "산부인과 응급 (OB-GYN emergency: 분만, 산과/부인과 통증)",
        "소아 응급 (Pediatric acute illness: 열, 경련, 탈수 등)",
        "정신과적 응급 (Psychiatric emergency: 자살위험, 폭력성, 급성정신병)"
      ],
      "mkiosk_flags": [
        "MKioskTy1",
        "MKioskTy10",
        "MKioskTy11",
        "MKioskTy12",
        "MKioskTy13",
        "MKioskTy14",
        "MKioskTy15",
        "MKioskTy16",
        "MKioskTy17",
        "MKioskTy18",
        "MKioskTy2",
        "MKioskTy20",
        "MKioskTy21",
        "MKioskTy22",
        "MKioskTy23",
        "MKioskTy24",
        "MKioskTy25",
        "MKioskTy26",
        "MKioskTy27",
        "MKioskTy28",
        "MKioskTy3",
        "MKioskTy4",
        "MKioskTy5",
        "MKioskTy6",
        "MKioskTy7",
        "MKioskTy8",
        "MKioskTy9"
      ],
      "coverage_score": 0.2,
      "coverage_level": "LOW",
      "priority_score": 4.5,
      "reason_summary": "KTAS 2, 주증상 '호흡곤란 (Dyspnea / Respiratory distress)' 환자에 대해 소화기 내시경(출혈 포함) 기준 총 유효 병상 6개가 남아 있어 후보로 선정됨. (시술 커버리지: 필수 시술 중 일부만 가능, 약 20% 충족)"
    }
  ]
}
```
