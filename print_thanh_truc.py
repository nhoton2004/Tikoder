import win32print, win32ui
from PIL import Image, ImageDraw, ImageFont, ImageWin

pname = 'Xprinter XP-470B'
max_h = 1180
total_canvas_w = 839
x0 = 180
content_w = 500
x1 = x0 + content_w

items = [
    ('70', '21:17:03 03/11/2026', '70.000 đ'),
    ('60 2c', '21:38:57 03/11/2026', '60.000 đ'),
    ('40', '21:43:16 03/11/2026', '40.000 đ'),
    ('50', '21:43:58 03/11/2026', '50.000 đ'),
    ('40', '21:46:19 03/11/2026', '40.000 đ'),
    ('45', '21:48:28 03/11/2026', '45.000 đ'),
    ('35', '21:51:56 03/11/2026', '35.000 đ'),
    ('Nau 20', '22:10:16 03/11/2026', '20.000 đ'),
    ('39', '22:12:17 03/11/2026', '39.000 đ'),
    ('15', '22:13:10 03/11/2026', '15.000 đ'),
    ('10', '22:14:32 03/11/2026', '10.000 đ'),
    ('15', '22:17:43 03/11/2026', '15.000 đ'),
    ('25', '22:23:31 03/11/2026', '25.000 đ'),
    ('20', '22:23:31 03/11/2026', '20.000 đ'),
    ('10', '22:30:30 03/11/2026', '10.000 đ'),
    ('110', '22:39:52 03/11/2026', '110.000 đ'),
    ('40', '22:49:17 03/11/2026', '40.000 đ'),
    ('20', '22:53:22 03/11/2026', '20.000 đ'),
    ('15', '23:03:27 03/11/2026', '15.000 đ'),
    ('75', '23:11:28 03/11/2026', '75.000 đ'),
    ('60', '23:12:53 03/11/2026', '60.000 đ'),
    ('20', '23:18:00 03/11/2026', '20.000 đ'),
    ('20', '23:20:17 03/11/2026', '20.000 đ'),
    ('35', '23:20:20 03/11/2026', '35.000 đ'),
    ('25', '23:40:55 03/11/2026', '25.000 đ'),
    ('20', '23:47:20 03/11/2026', '20.000 đ'),
    ('160', '23:49:21 03/11/2026', '160.000 đ'),
    ('65', '23:52:09 03/11/2026', '65.000 đ'),
    ('15', '23:57:00 03/11/2026', '15.000 đ'),
    ('19', '23:59:38 03/11/2026', '19.000 đ'),
    ('1', '01:34:31 04/11/2026', '1 d'),
    ('10', '00:34:21 05/11/2026', '10.000 đ'),
    ('10', '00:38:05 05/11/2026', '10.000 đ'),
    ('20', '00:39:21 05/11/2026', '20.000 đ'),
    ('10', '00:45:43 05/11/2026', '10.000 đ'),
    ('70', '00:47:18 05/11/2026', '70.000 đ'),
    ('29', '00:56:15 05/11/2026', '29.000 đ'),
    ('24', '01:03:26 05/11/2026', '24.000 đ'),
    ('10', '01:04:48 05/11/2026', '10.000 đ'),
    ('30', '01:07:12 05/11/2026', '30.000 đ'),
    ('10', '01:24:08 05/11/2026', '10.000 đ')
]

p1_items = items[:14]
p2_items = items[14:28]
p3_items = items[28:]

try:
    font_title = ImageFont.truetype('arialbd.ttf', 24)
    font_customer = ImageFont.truetype('arialbd.ttf', 26)
    font_text = ImageFont.truetype('arial.ttf', 18)
    font_bold = ImageFont.truetype('arialbd.ttf', 18)
    font_label = ImageFont.truetype('arialbd.ttf', 15)
    font_small = ImageFont.truetype('arial.ttf', 14)
    font_total = ImageFont.truetype('arialbd.ttf', 32)
except Exception:
    font_title = font_customer = font_text = font_bold = font_label = font_small = font_total = ImageFont.load_default()

def draw_dashed_line(draw, y_pos, width=1):
    dash_len = 8
    space_len = 6
    cur_x = x0
    while cur_x < x1:
        draw.line([(cur_x, y_pos), (min(cur_x + dash_len, x1), y_pos)], fill=(0, 0, 0), width=width)
        cur_x += dash_len + space_len
    return y_pos + 6

def center_in_box(draw, text, font, y_pos):
    bbox = draw.textbbox((0, 0), text, font=font)
    w = bbox[2] - bbox[0]
    draw.text((x0 + (content_w - w) / 2, y_pos), text, fill=(0, 0, 0), font=font)
    return y_pos + (bbox[3] - bbox[1]) + 5

# P1
img1 = Image.new('RGB', (total_canvas_w, max_h), color=(255, 255, 255))
d1 = ImageDraw.Draw(img1)
y = 10
y = center_in_box(d1, 'PHIEU TONG DON (1/3)', font_title, y)
d1.text((x0, y), 'Phien:', fill=(0, 0, 0), font=font_small)
d1.text((x0 + 45, y), '02:22:54 02/11/2026_anhthukyguitanphu', fill=(0, 0, 0), font=font_small)
y += 18
y = draw_dashed_line(d1, y)
d1.text((x0, y), 'KHACH HANG', fill=(0, 0, 0), font=font_label)
y += 18
d1.text((x0, y), 'Thanh Truc Ho', fill=(0, 0, 0), font=font_customer)
y += 30
d1.text((x0, y), '@thanh.trc.h97', fill=(0, 0, 0), font=font_text)
y += 24
y = draw_dashed_line(d1, y)
d1.text((x0, y), 'Noi dung', fill=(0, 0, 0), font=font_label)
bbox_tt = d1.textbbox((0, 0), 'Thanh tien', font=font_label)
d1.text((x1 - (bbox_tt[2] - bbox_tt[0]), y), 'Thanh tien', fill=(0, 0, 0), font=font_label)
y += 20

for name, time_str, price in p1_items:
    bbox_p = d1.textbbox((0, 0), price, font=font_bold)
    price_w = bbox_p[2] - bbox_p[0]
    d1.text((x1 - price_w, y), price, fill=(0, 0, 0), font=font_bold)
    d1.text((x0, y), name, fill=(0, 0, 0), font=font_bold)
    y += 18
    d1.text((x0, y), time_str, fill=(0, 0, 0), font=font_small)
    y += 18

y = draw_dashed_line(d1, y)
y = center_in_box(d1, '(Con tiep trang 2/3...)', font_bold, y + 10)

# P2
img2 = Image.new('RGB', (total_canvas_w, max_h), color=(255, 255, 255))
d2 = ImageDraw.Draw(img2)
y2 = 10
y2 = center_in_box(d2, 'PHIEU TONG DON (2/3)', font_title, y2)
d2.text((x0, y2), 'Khach:', fill=(0, 0, 0), font=font_label)
d2.text((x0 + 55, y2), 'Thanh Truc Ho (@thanh.trc.h97)', fill=(0, 0, 0), font=font_bold)
y2 += 22
y2 = draw_dashed_line(d2, y2)
d2.text((x0, y2), 'Noi dung', fill=(0, 0, 0), font=font_label)
d2.text((x1 - (bbox_tt[2] - bbox_tt[0]), y2), 'Thanh tien', fill=(0, 0, 0), font=font_label)
y2 += 20

for name, time_str, price in p2_items:
    bbox_p = d2.textbbox((0, 0), price, font=font_bold)
    price_w = bbox_p[2] - bbox_p[0]
    d2.text((x1 - price_w, y2), price, fill=(0, 0, 0), font=font_bold)
    d2.text((x0, y2), name, fill=(0, 0, 0), font=font_bold)
    y2 += 18
    d2.text((x0, y2), time_str, fill=(0, 0, 0), font=font_small)
    y2 += 18

y2 = draw_dashed_line(d2, y2)
y2 = center_in_box(d2, '(Con tiep trang 3/3...)', font_bold, y2 + 10)

# P3
img3 = Image.new('RGB', (total_canvas_w, max_h), color=(255, 255, 255))
d3 = ImageDraw.Draw(img3)
y3 = 10
y3 = center_in_box(d3, 'PHIEU TONG DON (3/3)', font_title, y3)
d3.text((x0, y3), 'Khach:', fill=(0, 0, 0), font=font_label)
d3.text((x0 + 55, y3), 'Thanh Truc Ho (@thanh.trc.h97)', fill=(0, 0, 0), font=font_bold)
y3 += 22
y3 = draw_dashed_line(d3, y3)
d3.text((x0, y3), 'Noi dung', fill=(0, 0, 0), font=font_label)
d3.text((x1 - (bbox_tt[2] - bbox_tt[0]), y3), 'Thanh tien', fill=(0, 0, 0), font=font_label)
y3 += 20

for name, time_str, price in p3_items:
    bbox_p = d3.textbbox((0, 0), price, font=font_bold)
    price_w = bbox_p[2] - bbox_p[0]
    d3.text((x1 - price_w, y3), price, fill=(0, 0, 0), font=font_bold)
    d3.text((x0, y3), name, fill=(0, 0, 0), font=font_bold)
    y3 += 18
    d3.text((x0, y3), time_str, fill=(0, 0, 0), font=font_small)
    y3 += 18

y3 = draw_dashed_line(d3, y3)
d3.text((x0, y3), 'So dong hang', fill=(0, 0, 0), font=font_label)
d3.text((x1 - 25, y3), '41', fill=(0, 0, 0), font=font_bold)
y3 += 20
y3 = draw_dashed_line(d3, y3)
d3.text((x0, y3), 'TONG TIEN', fill=(0, 0, 0), font=font_bold)
y3 += 22
bbox_total = d3.textbbox((0, 0), '1.416.001 d', font=font_total)
d3.text((x1 - (bbox_total[2] - bbox_total[0]), y3), '1.416.001 d', fill=(0, 0, 0), font=font_total)
y3 += 38
d3.line([(x0, y3), (x1, y3)], fill=(0, 0, 0), width=2)
y3 += 10
y3 = center_in_box(d3, 'Cam on ban da ung ho shop!', font_small, y3)
y3 = center_in_box(d3, 'Hen gap ban o live sau.', font_small, y3)
y3 = center_in_box(d3, 'Vui long doi chieu thong tin don.', font_small, y3)

crop1 = img1.crop((0, 0, total_canvas_w, max_h))
crop2 = img2.crop((0, 0, total_canvas_w, max_h))
crop3 = img3.crop((0, 0, total_canvas_w, max_h))

hprinter = win32print.OpenPrinter(pname)
try:
    hdc1 = win32ui.CreateDC()
    hdc1.CreatePrinterDC(pname)
    hdc1.StartDoc('Phieu Tong Thanh Truc Ho P1')
    hdc1.StartPage()
    dib1 = ImageWin.Dib(crop1)
    dib1.draw(hdc1.GetHandleOutput(), (0, 0, crop1.width, crop1.height))
    hdc1.EndPage()
    hdc1.EndDoc()
    hdc1.DeleteDC()

    hdc2 = win32ui.CreateDC()
    hdc2.CreatePrinterDC(pname)
    hdc2.StartDoc('Phieu Tong Thanh Truc Ho P2')
    hdc2.StartPage()
    dib2 = ImageWin.Dib(crop2)
    dib2.draw(hdc2.GetHandleOutput(), (0, 0, crop2.width, crop2.height))
    hdc2.EndPage()
    hdc2.EndDoc()
    hdc2.DeleteDC()

    hdc3 = win32ui.CreateDC()
    hdc3.CreatePrinterDC(pname)
    hdc3.StartDoc('Phieu Tong Thanh Truc Ho P3')
    hdc3.StartPage()
    dib3 = ImageWin.Dib(crop3)
    dib3.draw(hdc3.GetHandleOutput(), (0, 0, crop3.width, crop3.height))
    hdc3.EndPage()
    hdc3.EndDoc()
    hdc3.DeleteDC()
    print('PRINT_3PAGES_THANH_TRUC_SUCCESS')
finally:
    win32print.ClosePrinter(hprinter)
