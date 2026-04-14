# Ứng dụng quản lý tài chính cá nhân

Ứng dụng web một trang dùng để theo dõi tài khoản, giao dịch, báo cáo tài sản, phân tích thu chi và quản lý quỹ hoàn quỹ. Giao diện được viết trong một tệp `index.html`, dùng **Chart.js** để vẽ biểu đồ, **localStorage** để lưu dữ liệu cục bộ và có hỗ trợ đồng bộ đám mây qua **Supabase**.

## Mục tiêu của ứng dụng

Ứng dụng này không chỉ ghi thu chi hằng ngày, mà còn cố gắng mô hình hóa dòng tiền theo nhiều lớp:

- theo dõi số dư của nhiều tài khoản
- ghi nhận giao dịch theo loại và theo danh mục
- phân tích thu nhập, chi tiêu và dòng tiền ròng theo thời gian
- so sánh biến động giữa các giai đoạn
- quản lý quỹ hoàn quỹ với mốc mục tiêu động
- xuất và nhập dữ liệu toàn bộ dưới dạng tệp JSON
- đồng bộ một phần dữ liệu giữa nhiều thiết bị qua Supabase

## Các màn hình chính

### 1. Dashboard

Màn hình tổng quan hiển thị:

- tổng tài sản hiện có
- tổng thu
- tổng chi
- dòng tiền ròng
- cảnh báo các quỹ cần nộp trong bảy ngày tới
- tỷ trọng tài sản theo tài khoản
- phân bổ dòng tiền ròng theo tài khoản
- biến động tổng tài sản theo thời gian
- tỷ trọng thu nhập hoặc chi tiêu theo bộ lọc thời gian

### 2. Báo cáo thu chi

Cho phép lọc theo:

- khoảng thời gian nhanh
- ngày bắt đầu và ngày kết thúc
- tài khoản
- loại giao dịch
- đặc tính chi tiêu cố định hoặc không cố định

Ngoài các chỉ số tổng hợp, trang này còn có:

- biểu đồ tỷ trọng chi tiêu
- biểu đồ tỷ trọng thu nhập
- biểu đồ xu hướng thu và chi theo kỳ
- biểu đồ phân bổ chi tiêu theo danh mục
- bảng lịch sử giao dịch đã lọc

### 3. So sánh mục thu chi các tháng

Trang này dùng biểu đồ cột chồng để so sánh dao động theo:

- ngày
- tháng
- năm

Có thể so sánh theo:

- loại giao dịch
- tài khoản
- phân loại

Các bộ lọc nhiều lựa chọn được xây bằng danh sách thả xuống có ô chọn.

### 4. Quản lý nguồn nợ

Thực chất đây là phần quản lý **quỹ hoàn quỹ** hơn là quản lý khoản vay có lãi suất.

Tính năng chính:

- tạo quỹ với tài khoản liên kết
- đặt mốc mục tiêu hiện hành
- chọn chu kỳ theo dõi
- cấu hình ngày đến hạn trong kỳ
- theo dõi phần thiếu dồn từ kỳ trước
- ghi nhận nộp quỹ bằng cách liên kết trực tiếp với giao dịch thật
- tách riêng phần **bù hụt** và phần **tăng mốc**
- mô phỏng các kỳ tới theo mức nộp dự kiến
- lọc và phân trang lịch sử nộp quỹ

### 5. Dữ liệu giao dịch

Cho phép thêm, sửa, tìm kiếm, lọc và xóa mềm giao dịch.

Các loại giao dịch đang hỗ trợ:

- chi tiêu
- thu nhập
- chuyển khoản nội bộ
- điều chỉnh số dư

### 6. Phân loại tài khoản

Quản lý danh sách tài khoản như:

- tiền mặt
- ngân hàng
- tiết kiệm
- đầu tư
- loại khác

### 7. Thiết lập

Bao gồm:

- đơn vị tiền tệ
- chủ đề giao diện
- xuất dữ liệu ra tệp JSON
- nhập dữ liệu từ tệp JSON
- đăng nhập Supabase bằng liên kết gửi qua thư điện tử
- đồng bộ dữ liệu lên đám mây
- tải dữ liệu từ đám mây về thiết bị
- quản lý danh mục chi tiêu và danh mục thu nhập

## Công nghệ sử dụng

Ứng dụng hiện tại là một tệp đơn, không có bước dựng riêng.

- **HTML**: cấu trúc giao diện
- **CSS**: toàn bộ giao diện và chủ đề màu
- **JavaScript dạng mô-đun**: toàn bộ xử lý nghiệp vụ và kết xuất giao diện
- **Chart.js**: biểu đồ
- **Supabase JavaScript client**: xác thực và đồng bộ đám mây
- **localStorage**: lưu dữ liệu cục bộ trong trình duyệt

## Cấu trúc dữ liệu chính

Trạng thái ứng dụng được lưu trong một đối tượng tổng, với khóa local là:

```text
personal_finance_dashboard_state_v12
```

Cấu trúc tổng quát:

```json
{
  "version": 12,
  "meta": {
    "currency": "VND",
    "themeLabel": "dark-green",
    "lastSavedAt": "...",
    "lastCloudSyncAt": "...",
    "deviceId": "..."
  },
  "accounts": [],
  "categories": {
    "expense": [],
    "income": []
  },
  "transactions": [],
  "debtPlans": [],
  "debtEntries": []
}
```

### 1. Tài khoản

Mỗi tài khoản có các trường chính:

- `id`
- `name`
- `type`
- `openingBalance`
- `note`
- `created_at`
- `updated_at`
- `deleted_at`

### 2. Danh mục

Danh mục được tách thành hai nhóm:

- danh mục chi tiêu
- danh mục thu nhập

Mỗi mục có:

- `id`
- `kind`
- `name`
- `created_at`
- `updated_at`
- `deleted_at`

### 3. Giao dịch

Mỗi giao dịch có:

- `id`
- `type`
- `date`
- `amount`
- `accountFromId`
- `accountToId`
- `categoryId`
- `note`
- `expenseMode`
- `deviceId`
- `created_at`
- `updated_at`
- `deleted_at`

### 4. Quỹ hoàn quỹ

Mỗi quỹ có:

- `id`
- `kind`
- `name`
- `linkedAccountId`
- `currentTargetAmount`
- `cycle`
- `dueDay`
- `carryShortfall`
- `note`
- `created_at`
- `updated_at`
- `deleted_at`

### 5. Lịch sử nộp quỹ

Mỗi bản ghi nộp quỹ có:

- `id`
- `planId`
- `transactionId`
- `date`
- `amount`
- `replenishAmount`
- `growthAmount`
- `targetAfterPayment`
- `note`
- `created_at`
- `updated_at`
- `deleted_at`

## Quy tắc nghiệp vụ nổi bật

### Quy tắc nhập giao dịch

- không cho nhập ngày ở tương lai
- số tiền phải lớn hơn không
- giao dịch chi tiêu phải có tài khoản nguồn
- giao dịch thu nhập phải có tài khoản nhận
- chuyển khoản nội bộ bắt buộc tài khoản nguồn và tài khoản đích khác nhau
- điều chỉnh số dư phải xác định rõ cộng thêm hay trừ bớt

### Quy tắc quỹ hoàn quỹ

- quỹ bắt buộc phải liên kết với một tài khoản thật
- khi ghi nhận nộp quỹ, người dùng phải chọn một giao dịch thật đã đi vào tài khoản liên kết
- hệ thống tính phần bù hụt trước, phần còn lại mới được xem là phần tăng mốc
- mốc mục tiêu là mốc động, nghĩa là sau khi nộp vượt mức cần bù thì mốc mục tiêu cho các kỳ sau sẽ tăng lên

### Quy tắc đồng bộ dữ liệu

- mọi thay đổi sẽ lưu cục bộ ngay
- nếu đã đăng nhập đám mây, ứng dụng sẽ hẹn đồng bộ tự động sau một khoảng ngắn
- khi trộn dữ liệu, bản ghi có `updated_at` mới hơn sẽ được ưu tiên giữ lại
- danh mục được loại trùng theo tên sau khi trộn
- có hỗ trợ nghe sự kiện thay đổi `storage` để cập nhật khi mở nhiều thẻ trình duyệt

## Xuất và nhập dữ liệu

Ứng dụng hỗ trợ hai hướng sao lưu:

### Xuất dữ liệu

Xuất toàn bộ trạng thái hiện tại ra một tệp JSON. Tên tệp có dạng:

```text
tai-chinh-ca-nhan-ngay-thang-nam.json
```

### Nhập dữ liệu

Khi nhập tệp JSON, ứng dụng cho hai chế độ:

- `merge`: gộp với dữ liệu hiện có, tránh mất dữ liệu cũ
- `replace`: thay thế toàn bộ dữ liệu hiện tại bằng dữ liệu từ tệp

## Đồng bộ đám mây với Supabase

Ứng dụng đang kết nối trực tiếp tới Supabase bằng thông tin được khai báo trong mã nguồn.

### Cách hoạt động hiện tại

- người dùng đăng nhập bằng liên kết gửi qua thư điện tử
- sau khi đăng nhập, có thể bấm đồng bộ ngay hoặc tải dữ liệu từ đám mây về
- cơ chế hợp nhất dữ liệu dựa trên `updated_at`

### Phạm vi đồng bộ hiện tại

Ở phiên bản mã nguồn hiện tại, phần đồng bộ Supabase **mới chỉ áp dụng cho ba bảng**:

- `accounts`
- `categories`
- `transactions`

Điều này có nghĩa là:

- `debtPlans` và `debtEntries` vẫn tồn tại trong trạng thái cục bộ
- nhưng **chưa được tải lên hoặc tải về từ đám mây**
- nếu dùng nhiều thiết bị, phần quỹ hoàn quỹ có thể không nhất quán giữa các máy

### Gợi ý cấu hình bảng Supabase

Ứng dụng đang giả định các bảng sau có tồn tại và đều có cột `user_id`:

- `accounts`
- `categories`
- `transactions`

Nếu muốn đồng bộ đầy đủ hơn, cần bổ sung thêm:

- `debt_plans`
- `debt_entries`

và mở rộng logic tải lên, tải xuống trong mã nguồn.

## Cách chạy ứng dụng

### Cách đơn giản nhất

1. đặt tệp `index.html` vào một thư mục riêng
2. mở bằng trình duyệt hiện đại
3. bắt đầu tạo tài khoản, danh mục và giao dịch

### Cách khuyến nghị

Nên chạy qua một máy chủ cục bộ đơn giản để tránh các vấn đề liên quan đến mô-đun JavaScript hoặc xác thực trong một số trình duyệt.

Ví dụ, nếu máy có Python:

```bash
python -m http.server 8000
```

Sau đó mở:

```text
http://localhost:8000
```

## Trình duyệt khuyến nghị

- Google Chrome bản mới
- Microsoft Edge bản mới
- các trình duyệt hiện đại có hỗ trợ `type="module"`, `localStorage` và `showPicker` cho ô chọn ngày

## Điểm mạnh của phiên bản hiện tại

- giao diện đầy đủ, có nhiều màn hình rõ ràng
- không cần cơ sở dữ liệu để dùng ở chế độ cục bộ
- có biểu đồ và báo cáo trực quan
- có xuất và nhập dữ liệu để sao lưu
- có nền tảng để đồng bộ nhiều thiết bị
- phần quỹ hoàn quỹ có tư duy nghiệp vụ tốt hơn nhiều ứng dụng ghi chi tiêu đơn giản

## Hạn chế hiện tại

- toàn bộ ứng dụng nằm trong một tệp HTML duy nhất, khó bảo trì khi tiếp tục mở rộng
- phần đồng bộ đám mây mới bao phủ tài khoản, danh mục và giao dịch
- chưa có đồng bộ cho quỹ hoàn quỹ và lịch sử nộp quỹ
- chưa tách phần nghiệp vụ, phần giao diện và phần đồng bộ thành các mô-đun riêng
- chưa thấy lớp kiểm thử tự động cho các phép tính tài chính quan trọng
- phần quản lý nguồn nợ hiện tại phù hợp với quỹ hoàn quỹ hơn là quản lý khoản vay có lãi suất

## Hướng phát triển tiếp theo

### Ưu tiên cao

- đồng bộ `debtPlans` và `debtEntries` lên Supabase
- tách mã thành nhiều tệp theo chức năng
- chuẩn hóa bảng Supabase và quy tắc phân quyền theo người dùng
- bổ sung kiểm thử cho các phép tính số dư và quỹ

### Ưu tiên trung bình

- thêm ngân sách theo tháng
- thêm giao dịch lặp lại định kỳ
- thêm màn hình sao lưu và khôi phục rõ ràng hơn
- thêm nhật ký đồng bộ và xử lý xung đột tốt hơn

### Ưu tiên dài hạn

- chuyển sang kiến trúc có bước dựng
- viết thành ứng dụng tiến bộ trên nền web
- hỗ trợ nhiều loại mục tiêu tài chính
- mở rộng sang quản lý khoản vay có gốc, lãi suất và kỳ hạn

## Ghi chú cho người bảo trì

Nếu tiếp tục phát triển mã nguồn này, nên bắt đầu từ các điểm sau:

1. tách phần dữ liệu, phần nghiệp vụ và phần kết xuất giao diện
2. gom các hàm tính toán tài chính thành một mô-đun riêng
3. chuẩn hóa tên trường giữa local và cloud
4. bổ sung đồng bộ cho quỹ hoàn quỹ
5. viết kiểm thử cho các hàm hợp nhất và tính toán số dư

## Tình trạng hiện tại

Đây là một phiên bản có thể dùng được cho mục đích cá nhân, có độ hoàn thiện giao diện tốt và có nhiều tính năng hơn mức ghi chép thu chi cơ bản. Tuy nhiên, nếu muốn dùng ổn định trên nhiều thiết bị hoặc phát triển thành sản phẩm lâu dài, cần ưu tiên xử lý lại phần đồng bộ đám mây và kiến trúc mã nguồn.
