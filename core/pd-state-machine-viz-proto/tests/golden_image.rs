use std::fs::read;
use image::{DynamicImage, GenericImageView};

fn validate_golden_image() {
    let actual = read("docs/proof.png").expect("golden image missing");
    let expected = read("tests/golden/proof.png").expect("expected image missing");
    let actual_img = image::load_from_memory(&actual).expect("invalid actual");
    let expected_img = image::load_from_memory(&expected).expect("invalid expected");
    assert_eq!(actual_img.dimensions(), expected_img.dimensions(), "size mismatch");
    for (x, y, pixel) in actual_img.pixels() {
        let expected_pixel = expected_img.get_pixel(x, y);
        assert_eq!(pixel, expected_pixel, "pixel mismatch at ({x},{y})");
    }
}