import sys
import pypdfium2 as pdfium
from PIL import Image, ImageWin
import win32print, win32ui

pname = 'Xprinter XP-470B'
total_canvas_w = 839
max_h = 1180
x0 = 180
content_w = 500
y0 = 35

def print_pdf_pages(pdf_path, title_prefix='Van Don SPX', page_indices=None):
    pdf = pdfium.PdfDocument(pdf_path)
    total_pages = len(pdf)
    if page_indices is None:
        page_indices = list(range(total_pages))

    hprinter = win32print.OpenPrinter(pname)
    try:
        for idx in page_indices:
            page = pdf[idx]
            pil_img = page.render(scale=300 / 72).to_pil()
            aspect = pil_img.height / pil_img.width
            content_h = int(round(content_w * aspect))
            resized = pil_img.resize((content_w, content_h), Image.Resampling.LANCZOS)

            canvas = Image.new('RGB', (total_canvas_w, max_h), color=(255, 255, 255))
            canvas.paste(resized, (x0, y0))

            doc_title = f'{title_prefix} Trang {idx + 1}'
            hdc = win32ui.CreateDC()
            hdc.CreatePrinterDC(pname)
            hdc.StartDoc(doc_title)
            hdc.StartPage()

            dib = ImageWin.Dib(canvas)
            dib.draw(hdc.GetHandleOutput(), (0, 0, canvas.width, canvas.height))

            hdc.EndPage()
            hdc.EndDoc()
            hdc.DeleteDC()
            print(f'PRINTED_SUCCESS: {doc_title}')
    finally:
        win32print.ClosePrinter(hprinter)

if __name__ == '__main__':
    pdf_trung = r'C:\Users\Hoang Nho\AppData\Local\hermes\profiles\tiktok_flow\cache\documents\native-inputs\80a2649e89d000b36d76215670a942f50729804f58626cd33fbd8f17c187c950\doc_ffafc82bdf2e_anhthu-trung-2.pdf'
    pdf_nho = r'C:\Users\Hoang Nho\AppData\Local\hermes\profiles\tiktok_flow\cache\documents\native-inputs\106bfa73235a43fc5928141984b0a8dd002d45feb3f40f7ea8b564291872a28d\doc_c0d74a771afc_anhthu-nho-10.pdf'

    print('=== IN 2 ĐƠN TRUNG ===')
    print_pdf_pages(pdf_trung, title_prefix='Don Trung')

    print('=== IN 10 ĐƠN NHỎ ===')
    print_pdf_pages(pdf_nho, title_prefix='Don Nho')
    print('ALL_PRINT_DONE')
