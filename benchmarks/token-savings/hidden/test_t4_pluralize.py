import pytest
import click

def test_basic():
    assert click.pluralize(1, "file") == "1 file"
    assert click.pluralize(2, "file") == "2 files"
    assert click.pluralize(0, "file") == "0 files"

def test_irregular():
    assert click.pluralize(3, "child", "children") == "3 children"
    assert click.pluralize(1, "child", "children") == "1 child"

def test_negative():
    with pytest.raises(ValueError):
        click.pluralize(-1, "file")
