const searchInput = document.querySelector(".form__input")
const searchButton = document.querySelector(".form__submit")
const productContainer = document.querySelector(".product__container")

const searchValue = (e) => {
    if (searchInput.value !== "") {
        e.preventDefault()
        let resultList = []
        let productList = document.querySelectorAll(".product")
        let searchValue = searchInput.value
        productList.forEach((product) => {
            if (product.children[0].innerText.includes(searchValue)) {
                resultList.push(product)
            }
        })
        console.log(resultList)
        productContainer.innerHTML = ""
        resultList.forEach((elem) => {
            productContainer.appendChild(elem)
        })
        searchInput.value = ""
    }
}
searchButton.addEventListener("click", searchValue)
