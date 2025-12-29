import logoVideplast from '../assets/videplast-brand.png'

const Header = () => {
  return (
    <header className="container text-center py-4">
      <img 
        src={logoVideplast} 
        alt="Videplast" 
        className="img-fluid mb-3 header-logo" 
      />
    </header>
  )
}

export default Header