# In hóa đơn trên giấy 80 mm

1. Mở hộp thoại in của trình duyệt và chọn đúng máy in cùng profile giấy 80 mm.
2. Giữ tỷ lệ ở `100%` nếu driver đã khai báo đúng khổ giấy. Nếu nội dung bị cắt ngang, dùng `Fit to printable area` của driver thay vì tăng chiều rộng trong CSS.
3. Tắt `Headers and footers` để trình duyệt không thêm URL, ngày giờ hoặc số trang.
4. Kiểm tra preview trước khi in thật: tên khách và tổng tiền phải còn nguyên, tiền từng dòng phải nằm bên phải.

Nội dung web được giới hạn ở 72 mm để chừa vùng không in được của phần lớn profile 80 mm. Vùng in thực tế vẫn phụ thuộc driver và máy in; CSS không thể bảo đảm loại bỏ header/footer do trình duyệt hoặc driver tự thêm.
